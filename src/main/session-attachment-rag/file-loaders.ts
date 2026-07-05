import { setTimeout } from 'node:timers/promises'
import { APICallError, type EmbeddingModel, embedMany } from 'ai'
import { ApiError, NetworkError } from '../../shared/models/errors'
import { sentry } from '../../shared/sentry-shim'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../shared/session-attachment-rag/logging'
import { getStoreBlob } from '../store-node'
import { getLogger } from '../util'
import { buildAttachmentChunks, buildEmbeddedText, selectAttachmentChunkingPipeline } from './chunking'
import {
  deleteAttachmentGraph,
  deleteAttachmentIndex,
  getSessionAttachment,
  getVectorStore,
  listPendingSessionAttachments,
  markSessionAttachmentFailed,
  markSessionAttachmentIndexing,
  markSessionAttachmentReady,
  purgeCanceledSessionAttachments,
  replaceAttachmentParentsAndChunks,
  runVectorWrite,
  updateSessionAttachmentIndexingProgress,
} from './db'
import { getSessionAttachmentEmbeddingProvider } from './model-providers'

const log = getLogger('session-attachment-rag:file-loaders')
const BATCH_SIZE = 50
const EMBEDDING_MAX_RETRIES = 2
const EMBEDDING_RETRY_DELAY_MS = 1000

class SessionAttachmentCanceledError extends Error {
  constructor(attachmentId: number) {
    super(`Session attachment ${attachmentId} was canceled`)
    this.name = 'SessionAttachmentCanceledError'
  }
}

async function ensureAttachmentNotCanceled(attachmentId: number) {
  const attachment = await getSessionAttachment(attachmentId)
  if (!attachment || attachment.status === 'canceled') {
    throw new SessionAttachmentCanceledError(attachmentId)
  }
  return attachment
}

function isTransientEmbeddingError(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return true
  }

  if (APICallError.isInstance(error)) {
    const statusCode = error.statusCode
    return statusCode === 429 || (statusCode !== undefined && statusCode >= 500 && statusCode < 600)
  }

  if (error instanceof ApiError) {
    const statusCode = error.statusCode
    return statusCode === 429 || (statusCode !== undefined && statusCode >= 500 && statusCode < 600)
  }

  if (error && typeof error === 'object' && 'statusCode' in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode
    return typeof statusCode === 'number' && (statusCode === 429 || (statusCode >= 500 && statusCode < 600))
  }

  return false
}

async function embedManyWithRetry(model: EmbeddingModel, values: string[]) {
  let attempt = 0

  while (true) {
    try {
      return await embedMany({
        model,
        values,
        maxRetries: 0,
      })
    } catch (error) {
      attempt += 1
      if (attempt > EMBEDDING_MAX_RETRIES || !isTransientEmbeddingError(error)) {
        throw error
      }

      const message = error instanceof Error ? error.message : String(error)
      log.warn(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Retrying embedding batch after transient error (attempt ${attempt}/${EMBEDDING_MAX_RETRIES}): ${message}`
      )
      await setTimeout(EMBEDDING_RETRY_DELAY_MS * attempt)
    }
  }
}

async function processAttachment(attachmentId: number) {
  const attachment = await ensureAttachmentNotCanceled(attachmentId)
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Begin processing attachment: id=${attachment.id}, file="${attachment.filename}", parser=${attachment.parserType ?? 'unknown'}, storageKey=${attachment.attachmentStorageKey}`
  )

  const content = await getStoreBlob(attachment.attachmentStorageKey)
  if (!content?.trim()) {
    throw new Error('Attachment content not found or empty')
  }
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Loaded parsed content: attachmentId=${attachment.id}, chars=${content.length}, bytes=${new TextEncoder().encode(content).length}`
  )

  const chunkingPipeline = selectAttachmentChunkingPipeline(attachment.filename)
  await updateSessionAttachmentIndexingProgress(attachmentId, {
    indexingStage: 'chunking',
    totalChunks: 0,
    embeddedChunks: 0,
  })
  const { parents, children } = await buildAttachmentChunks(content, attachment.filename)
  if (parents.length === 0 || children.length === 0) {
    throw new Error('Attachment did not produce any retrievable chunks')
  }
  await ensureAttachmentNotCanceled(attachmentId)
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Chunking completed: attachmentId=${attachment.id}, pipeline=${chunkingPipeline}, parents=${parents.length}, children=${children.length}`
  )

  const parentIdMap = await replaceAttachmentParentsAndChunks(
    attachment.id,
    parents.map((parent) => ({
      parentOrder: parent.parentOrder,
      sectionPath: parent.sectionPath,
      docType: attachment.mimeType,
      text: parent.text,
      tokenEstimate: parent.tokenEstimate,
      charCount: parent.charCount,
    })),
    children.map((child) => ({
      parentOrder: child.parentOrder,
      chunkOrder: child.chunkOrder,
      sectionPath: child.sectionPath,
      rawText: child.rawText,
      embeddedText: buildEmbeddedText({
        filename: attachment.filename,
        sectionPath: child.sectionPath,
        text: child.rawText,
      }),
      tokenEstimate: child.tokenEstimate,
    }))
  )
  await ensureAttachmentNotCanceled(attachmentId)
  await updateSessionAttachmentIndexingProgress(attachmentId, {
    indexingStage: 'embedding',
    totalChunks: children.length,
    embeddedChunks: 0,
  })

  const indexName = `sa_${attachment.id}`
  const embeddingModel = await getSessionAttachmentEmbeddingProvider()

  const embeddedTexts = children.map((child) =>
    buildEmbeddedText({
      filename: attachment.filename,
      sectionPath: child.sectionPath,
      text: child.rawText,
    })
  )

  const firstEmbedding = await embedManyWithRetry(embeddingModel, [embeddedTexts[0]])
  await ensureAttachmentNotCanceled(attachmentId)
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Embedding initialized: attachmentId=${attachment.id}, dimension=${firstEmbedding.embeddings[0].length}, totalChunks=${embeddedTexts.length}`
  )
  await runVectorWrite(() =>
    getVectorStore().createIndex({
      indexName,
      dimension: firstEmbedding.embeddings[0].length,
    })
  )

  for (let index = 0; index < embeddedTexts.length; index += BATCH_SIZE) {
    await ensureAttachmentNotCanceled(attachmentId)
    const batchValues = embeddedTexts.slice(index, index + BATCH_SIZE)
    const batchChildren = children.slice(index, index + BATCH_SIZE)
    let embeddings = firstEmbedding.embeddings
    if (index !== 0) {
      const embeddingResult = await embedManyWithRetry(embeddingModel, batchValues)
      embeddings = embeddingResult.embeddings
    } else if (batchValues.length > 1) {
      const restEmbeddingResult = await embedManyWithRetry(embeddingModel, batchValues.slice(1))
      embeddings = [firstEmbedding.embeddings[0], ...restEmbeddingResult.embeddings]
    }

    await runVectorWrite(() =>
      getVectorStore().upsert({
        indexName,
        ids: batchChildren.map((child) => `${indexName}_${child.chunkOrder}`),
        vectors: embeddings,
        metadata: batchChildren.map((child) => ({
          attachmentId: attachment.id,
          parentId: parentIdMap.get(child.parentOrder),
          filename: attachment.filename,
          sectionPath: child.sectionPath,
          chunkOrder: child.chunkOrder,
          text: buildEmbeddedText({
            filename: attachment.filename,
            sectionPath: child.sectionPath,
            text: child.rawText,
          }),
          rawText: child.rawText,
        })),
      })
    )
    await updateSessionAttachmentIndexingProgress(attachmentId, {
      indexingStage: 'embedding',
      totalChunks: children.length,
      embeddedChunks: Math.min(index + batchChildren.length, children.length),
    })
    log.debug(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Upserted embedding batch: attachmentId=${attachment.id}, batchStart=${index}, batchSize=${batchChildren.length}`
    )

    if (index + BATCH_SIZE < embeddedTexts.length) {
      await setTimeout(100)
    }
  }

  await updateSessionAttachmentIndexingProgress(attachmentId, {
    indexingStage: 'finalizing',
    totalChunks: children.length,
    embeddedChunks: children.length,
  })
  log.info(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Attachment processing completed: id=${attachment.id}, file="${attachment.filename}"`
  )
}

async function processPendingAttachments() {
  await purgeCanceledSessionAttachments(20)

  const pending = await listPendingSessionAttachments(5)
  if (pending.length === 0) {
    return
  }

  for (const attachment of pending) {
    try {
      log.debug(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Transition pending -> indexing: attachmentId=${attachment.id}, file="${attachment.filename}"`
      )
      const markedIndexing = await markSessionAttachmentIndexing(attachment.id)
      if (!markedIndexing) {
        log.debug(
          `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Skip attachment that is no longer pending: attachmentId=${attachment.id}, file="${attachment.filename}"`
        )
        continue
      }
      await deleteAttachmentIndex(attachment.id)
      await processAttachment(attachment.id)
      await ensureAttachmentNotCanceled(attachment.id)
      log.debug(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Transition indexing -> ready: attachmentId=${attachment.id}, file="${attachment.filename}"`
      )
      const markedReady = await markSessionAttachmentReady(attachment.id)
      if (!markedReady) {
        await ensureAttachmentNotCanceled(attachment.id)
        throw new Error(`Failed to mark attachment ${attachment.id} ready`)
      }
    } catch (error) {
      if (error instanceof SessionAttachmentCanceledError) {
        log.debug(
          `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Attachment canceled during processing: attachmentId=${attachment.id}, file="${attachment.filename}"`
        )
        await deleteAttachmentGraph(attachment.id)
        continue
      }
      const message = error instanceof Error ? error.message : String(error)
      log.error(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Failed to process attachment ${attachment.id} (${attachment.filename}):`,
        error
      )
      log.debug(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Transition indexing -> failed: attachmentId=${attachment.id}, error=${message}`
      )
      await markSessionAttachmentFailed(attachment.id, message)
      sentry.withScope((scope) => {
        scope.setTag('component', 'session-attachment-rag-file')
        scope.setTag('operation', 'process_attachment')
        scope.setExtra('attachmentId', attachment.id)
        scope.setExtra('filename', attachment.filename)
        sentry.captureException(error)
      })
    }
  }
}

export async function startWorkerLoop() {
  log.info(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Starting session attachment rag worker loop`)
  while (true) {
    try {
      await processPendingAttachments()
    } catch (error) {
      log.error(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Session attachment rag worker loop error:`, error)
      sentry.withScope((scope) => {
        scope.setTag('component', 'session-attachment-rag-file')
        scope.setTag('operation', 'worker_loop')
        sentry.captureException(error)
      })
      await setTimeout(10000)
    }
    await setTimeout(3000)
  }
}
