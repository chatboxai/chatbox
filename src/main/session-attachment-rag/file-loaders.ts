import { setTimeout } from 'node:timers/promises'
import { APICallError, type EmbeddingModel, embedMany } from 'ai'
import { ApiError, NetworkError } from '../../shared/models/errors'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../shared/session-attachment-rag/logging'
import { sentry } from '../adapters/sentry'
import { getStoreBlob } from '../store-node'
import { getLogger } from '../util'
import { buildAttachmentChunks, buildEmbeddedText, selectAttachmentChunkingPipeline } from './chunking'
import {
  deleteAttachmentGraph,
  deleteAttachmentIndexOrThrow,
  getSessionAttachment,
  getVectorStore,
  hasAttachmentVectorIndex,
  listPendingSessionAttachments,
  listSessionAttachmentChunks,
  markSessionAttachmentFailed,
  markSessionAttachmentIndexing,
  markSessionAttachmentReady,
  purgeCanceledSessionAttachments,
  replaceAttachmentParentsAndChunks,
  resetSessionAttachmentIndexingCheckpoint,
  runVectorWrite,
  type SessionAttachmentChunkRecord,
  type SessionAttachmentRecord,
  updateSessionAttachmentIndexingProgress,
} from './db'
import {
  getSessionAttachmentEmbeddingProviderWithResolution,
  type SessionAttachmentEmbeddingProviderResolution,
} from './model-providers'

const log = getLogger('session-attachment-rag:file-loaders')
const BATCH_SIZE = 50
const EMBEDDING_MAX_RETRIES = 2
const EMBEDDING_RETRY_DELAY_MS = 1000
const DEFAULT_EMBEDDING_BATCH_TIMEOUT_MS = 60_000
const EMBEDDING_TIMEOUT_ENV = 'SESSION_ATTACHMENT_RAG_EMBEDDING_TIMEOUT_MS'

class SessionAttachmentCanceledError extends Error {
  constructor(attachmentId: number) {
    super(`Session attachment ${attachmentId} was canceled`)
    this.name = 'SessionAttachmentCanceledError'
  }
}

class SessionAttachmentEmbeddingDimensionMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(`Embedding dimension changed from ${expected} to ${actual}`)
    this.name = 'SessionAttachmentEmbeddingDimensionMismatchError'
  }
}

class SessionAttachmentEmbeddingTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Embedding request timed out after ${timeoutMs / 1000} seconds`)
    this.name = 'SessionAttachmentEmbeddingTimeoutError'
  }
}

function getEmbeddingBatchTimeoutMs() {
  if (process.env.NODE_ENV === 'production') {
    return DEFAULT_EMBEDDING_BATCH_TIMEOUT_MS
  }
  const configured = Number.parseInt(process.env[EMBEDDING_TIMEOUT_ENV] ?? '', 10)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_EMBEDDING_BATCH_TIMEOUT_MS
}

export interface SessionAttachmentWorkerDependencies {
  getContent(storageKey: string): Promise<string | null | undefined>
  resolveEmbeddingProvider(): Promise<SessionAttachmentEmbeddingProviderResolution>
  embedValues(model: EmbeddingModel, values: string[]): Promise<number[][]>
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

export async function embedManyWithRetry(model: EmbeddingModel, values: string[]) {
  let attempt = 0
  const timeoutMs = getEmbeddingBatchTimeoutMs()
  const deadline = Date.now() + timeoutMs

  while (true) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      throw new SessionAttachmentEmbeddingTimeoutError(timeoutMs)
    }

    const abortController = new AbortController()
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        abortController.abort()
        reject(new SessionAttachmentEmbeddingTimeoutError(timeoutMs))
      }, remainingMs)
    })

    try {
      return await Promise.race([
        embedMany({
          model,
          values,
          maxRetries: 0,
          abortSignal: abortController.signal,
        }),
        timeoutPromise,
      ])
    } catch (error) {
      if (error instanceof SessionAttachmentEmbeddingTimeoutError) {
        throw error
      }
      attempt += 1
      if (attempt > EMBEDDING_MAX_RETRIES || !isTransientEmbeddingError(error)) {
        throw error
      }

      const message = error instanceof Error ? error.message : String(error)
      log.warn(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Retrying embedding batch after transient error (attempt ${attempt}/${EMBEDDING_MAX_RETRIES}): ${message}`
      )
      const retryDelayMs = EMBEDDING_RETRY_DELAY_MS * attempt
      if (Date.now() + retryDelayMs >= deadline) {
        throw new SessionAttachmentEmbeddingTimeoutError(timeoutMs)
      }
      await setTimeout(retryDelayMs)
    } finally {
      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId)
      }
    }
  }
}

const defaultWorkerDependencies: SessionAttachmentWorkerDependencies = {
  getContent: getStoreBlob,
  resolveEmbeddingProvider: getSessionAttachmentEmbeddingProviderWithResolution,
  embedValues: async (model, values) => (await embedManyWithRetry(model, values)).embeddings,
}

function validateEmbeddingBatch(embeddings: number[][], expectedCount: number, expectedDimension?: number) {
  if (embeddings.length !== expectedCount) {
    throw new Error(`Embedding batch failed: expected ${expectedCount}, got ${embeddings.length}`)
  }
  for (const embedding of embeddings) {
    if (embedding.length === 0) {
      throw new Error('Embedding provider returned an empty vector')
    }
    if (expectedDimension !== undefined && embedding.length !== expectedDimension) {
      throw new SessionAttachmentEmbeddingDimensionMismatchError(expectedDimension, embedding.length)
    }
  }
}

async function getContinuationPlan(
  attachment: SessionAttachmentRecord,
  embeddingModel: string
): Promise<
  | {
      chunks: SessionAttachmentChunkRecord[]
      embeddedChunks: number
      embeddingDimension: number
    }
  | undefined
> {
  const totalChunks = attachment.totalChunks ?? 0
  const embeddedChunks = attachment.embeddedChunks ?? 0
  const embeddingDimension = attachment.embeddingDimension ?? 0
  if (
    totalChunks <= 0 ||
    embeddedChunks < 0 ||
    embeddedChunks > totalChunks ||
    attachment.chunkCount !== totalChunks ||
    attachment.embeddingModel !== embeddingModel ||
    embeddingDimension <= 0 ||
    !(await hasAttachmentVectorIndex(attachment.id))
  ) {
    return undefined
  }

  const chunks = await listSessionAttachmentChunks(attachment.id)
  if (chunks.length !== totalChunks || chunks.some((chunk, index) => chunk.chunkOrder !== index)) {
    return undefined
  }

  return { chunks, embeddedChunks, embeddingDimension }
}

export async function isSessionAttachmentCheckpointResumable(
  attachment: SessionAttachmentRecord,
  embeddingModel: string
): Promise<boolean> {
  return Boolean(await getContinuationPlan(attachment, embeddingModel))
}

async function embedAttachmentChunks(params: {
  attachment: SessionAttachmentRecord
  chunks: SessionAttachmentChunkRecord[]
  startIndex: number
  embeddingModel: EmbeddingModel
  embeddingDimension: number
  dependencies: SessionAttachmentWorkerDependencies
  prefetchedFirstEmbedding?: number[]
}) {
  const { attachment, chunks, startIndex, embeddingModel, embeddingDimension, dependencies, prefetchedFirstEmbedding } =
    params
  const indexName = `sa_${attachment.id}`

  for (let index = startIndex; index < chunks.length; index += BATCH_SIZE) {
    await ensureAttachmentNotCanceled(attachment.id)
    const batchChunks = chunks.slice(index, index + BATCH_SIZE)
    const batchValues = batchChunks.map((chunk) => chunk.embeddedText)
    let embeddings: number[][]
    if (index === 0 && prefetchedFirstEmbedding) {
      embeddings = [prefetchedFirstEmbedding]
      if (batchValues.length > 1) {
        embeddings.push(...(await dependencies.embedValues(embeddingModel, batchValues.slice(1))))
      }
    } else {
      embeddings = await dependencies.embedValues(embeddingModel, batchValues)
    }
    validateEmbeddingBatch(embeddings, batchValues.length, embeddingDimension)
    await ensureAttachmentNotCanceled(attachment.id)

    await runVectorWrite(() =>
      getVectorStore().upsert({
        indexName,
        ids: batchChunks.map((chunk) => `${indexName}_${chunk.chunkOrder}`),
        vectors: embeddings,
        metadata: batchChunks.map((chunk) => ({
          attachmentId: attachment.id,
          parentId: chunk.parentId,
          filename: attachment.filename,
          sectionPath: chunk.sectionPath,
          chunkOrder: chunk.chunkOrder,
          text: chunk.embeddedText,
          rawText: chunk.rawText,
        })),
      })
    )
    await updateSessionAttachmentIndexingProgress(attachment.id, {
      indexingStage: 'embedding',
      totalChunks: chunks.length,
      embeddedChunks: Math.min(index + batchChunks.length, chunks.length),
    })
    log.debug(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Upserted embedding batch: attachmentId=${attachment.id}, batchStart=${index}, batchSize=${batchChunks.length}`
    )

    if (index + BATCH_SIZE < chunks.length) {
      await setTimeout(100)
    }
  }
}

async function processAttachmentFromScratch(
  attachment: SessionAttachmentRecord,
  embeddingResolution: SessionAttachmentEmbeddingProviderResolution,
  dependencies: SessionAttachmentWorkerDependencies
) {
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Begin processing attachment: id=${attachment.id}, file="${attachment.filename}", parser=${attachment.parserType ?? 'unknown'}, storageKey=${attachment.attachmentStorageKey}`
  )

  const content = await dependencies.getContent(attachment.attachmentStorageKey)
  if (!content?.trim()) {
    throw new Error('Attachment content not found or empty')
  }

  const chunkingPipeline = selectAttachmentChunkingPipeline(attachment.filename)
  const { parents, children } = await buildAttachmentChunks(content, attachment.filename)
  if (parents.length === 0 || children.length === 0) {
    throw new Error('Attachment did not produce any retrievable chunks')
  }
  await ensureAttachmentNotCanceled(attachment.id)
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Chunking completed: attachmentId=${attachment.id}, pipeline=${chunkingPipeline}, parents=${parents.length}, children=${children.length}`
  )

  await replaceAttachmentParentsAndChunks(
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
  await ensureAttachmentNotCanceled(attachment.id)
  await updateSessionAttachmentIndexingProgress(attachment.id, {
    indexingStage: 'embedding',
    totalChunks: children.length,
    embeddedChunks: 0,
  })

  const indexName = `sa_${attachment.id}`
  const embeddingModel = embeddingResolution.provider
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [MODEL] Actual embedding model selected: attachmentId=${attachment.id}, source=${embeddingResolution.source}, model=${embeddingResolution.modelString}`
  )

  const chunks = await listSessionAttachmentChunks(attachment.id)
  const firstEmbeddings = await dependencies.embedValues(embeddingModel, [chunks[0].embeddedText])
  validateEmbeddingBatch(firstEmbeddings, 1)
  const embeddingDimension = firstEmbeddings[0].length
  await ensureAttachmentNotCanceled(attachment.id)
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Embedding initialized: attachmentId=${attachment.id}, dimension=${embeddingDimension}, totalChunks=${chunks.length}`
  )
  await updateSessionAttachmentIndexingProgress(attachment.id, {
    indexingStage: 'embedding',
    totalChunks: chunks.length,
    embeddedChunks: 0,
    embeddingModel: embeddingResolution.modelString,
    embeddingDimension,
  })
  await runVectorWrite(() =>
    getVectorStore().createIndex({
      indexName,
      dimension: embeddingDimension,
    })
  )

  await embedAttachmentChunks({
    attachment,
    chunks,
    startIndex: 0,
    embeddingModel,
    embeddingDimension,
    dependencies,
    prefetchedFirstEmbedding: firstEmbeddings[0],
  })
}

async function processAttachment(attachmentId: number, dependencies: SessionAttachmentWorkerDependencies) {
  const attachment = await ensureAttachmentNotCanceled(attachmentId)
  const embeddingResolution = await dependencies.resolveEmbeddingProvider()
  const continuation = await getContinuationPlan(attachment, embeddingResolution.modelString)

  if (continuation) {
    log.info(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Continuing attachment indexing: attachmentId=${attachment.id}, embeddedChunks=${continuation.embeddedChunks}, totalChunks=${continuation.chunks.length}`
    )
    try {
      await updateSessionAttachmentIndexingProgress(attachment.id, {
        indexingStage: 'embedding',
        totalChunks: continuation.chunks.length,
        embeddedChunks: continuation.embeddedChunks,
      })
      await embedAttachmentChunks({
        attachment,
        chunks: continuation.chunks,
        startIndex: continuation.embeddedChunks,
        embeddingModel: embeddingResolution.provider,
        embeddingDimension: continuation.embeddingDimension,
        dependencies,
      })
    } catch (error) {
      if (!(error instanceof SessionAttachmentEmbeddingDimensionMismatchError)) {
        throw error
      }
      log.warn(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Embedding space changed; rebuilding attachment index: attachmentId=${attachment.id}, error=${error.message}`
      )
      await deleteAttachmentIndexOrThrow(attachment.id)
      await resetSessionAttachmentIndexingCheckpoint(attachment.id)
      await processAttachmentFromScratch(attachment, embeddingResolution, dependencies)
    }
  } else {
    await deleteAttachmentIndexOrThrow(attachment.id)
    await resetSessionAttachmentIndexingCheckpoint(attachment.id)
    await processAttachmentFromScratch(attachment, embeddingResolution, dependencies)
  }

  await updateSessionAttachmentIndexingProgress(attachmentId, {
    indexingStage: 'finalizing',
  })
  log.info(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [FILE] Attachment processing completed: id=${attachment.id}, file="${attachment.filename}"`
  )
}

export async function processPendingAttachmentsOnce(
  dependencies: SessionAttachmentWorkerDependencies = defaultWorkerDependencies
) {
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
      await processAttachment(attachment.id, dependencies)
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
      await processPendingAttachmentsOnce()
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
