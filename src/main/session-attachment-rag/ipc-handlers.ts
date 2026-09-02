import type { SessionAttachmentQueryPlan, SessionAttachmentRagMaintenanceScope } from '@shared/types'
import { embedMany } from 'ai'
import { ipcMain } from 'electron'
import { rerank } from '../../shared/models/rerank'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../shared/session-attachment-rag/logging'
import { sentry } from '../adapters/sentry'
import { getLogger } from '../util'
import {
  cleanupOrphanAttachments,
  clearAllSessionAttachments,
  createSessionAttachment,
  deleteMessageAttachments,
  deleteSessionAttachments,
  deleteSingleAttachment,
  getSessionAttachmentDebugSnapshot,
  getVectorStore,
  listSessionAttachmentsByIds,
  parseSQLiteTimestamp,
  purgeCanceledSessionAttachments,
  readSessionAttachmentParents,
  rebindSessionAttachment,
  retrySessionAttachment,
  type SessionAttachmentRecord,
} from './db'
import { isSessionAttachmentCheckpointResumable } from './file-loaders'
import {
  getSessionAttachmentEmbeddingModelString,
  getSessionAttachmentEmbeddingProvider,
  getSessionAttachmentRerankProvider,
} from './model-providers'

const log = getLogger('session-attachment-rag:ipc-handlers')
const QUERY_RECALL_TOP_K = 20
const QUERY_RETURN_TOP_K = 8
const QUERY_RETURN_TOP_K_MAX = 12

function toTimestamp(value?: string) {
  return value ? parseSQLiteTimestamp(value) : undefined
}

async function toRendererSessionAttachment(attachment: SessionAttachmentRecord, embeddingModel?: string) {
  const resumable =
    attachment.status === 'failed' && embeddingModel
      ? await isSessionAttachmentCheckpointResumable(attachment, embeddingModel)
      : false
  return {
    ...attachment,
    availability: 'allowed' as const,
    indexStatus: attachment.status,
    chunkCount: attachment.chunkCount ?? 0,
    resumable,
    createdAt: toTimestamp(attachment.createdAt),
    processingStartedAt: toTimestamp(attachment.processingStartedAt),
    completedAt: toTimestamp(attachment.completedAt),
  }
}

function dedupeByParent<T extends { parentId: number }>(results: T[]) {
  const deduped = new Map<number, T>()
  for (const result of results) {
    if (!deduped.has(result.parentId)) {
      deduped.set(result.parentId, result)
    }
  }
  return [...deduped.values()]
}

/**
 * Format a user query for logs without leaking the full text. The main process log file
 * sits in a user-readable location on disk, so query content (which can include private
 * questions about uploaded documents) should not be persisted verbatim.
 */
function summarizeQuery(query: string): string {
  const trimmed = query.trim()
  const length = trimmed.length
  const previewLength = 16
  const preview = trimmed.slice(0, previewLength).replace(/\s+/g, ' ')
  const ellipsis = length > previewLength ? '...' : ''
  return `len=${length}, prefix="${preview}${ellipsis}"`
}

function normalizeQueryPlan(plan?: SessionAttachmentQueryPlan) {
  const recallTopK = Math.max(1, Math.min(plan?.recallTopK ?? QUERY_RECALL_TOP_K, QUERY_RECALL_TOP_K))
  const finalTopK = Math.max(1, Math.min(plan?.finalTopK ?? QUERY_RETURN_TOP_K, QUERY_RETURN_TOP_K_MAX))
  const rerankPlan = plan?.rerank?.enabled ? { enabled: true, model: plan.rerank.model } : { enabled: false as const }
  return { recallTopK, finalTopK, rerank: rerankPlan }
}

export function registerSessionAttachmentRagHandlers() {
  ipcMain.handle('session-attachment-rag:create', async (_event, params) => {
    log.debug(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Create attachment task: session=${params.sessionId}, message=${params.messageId}, file="${params.filename}", parser=${params.parserType ?? 'unknown'}`
    )
    const id = await createSessionAttachment(params)
    const attachment = (await listSessionAttachmentsByIds([id]))[0]
    log.debug(
      `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Attachment task created: attachmentId=${id}, status=${attachment?.status}`
    )
    return attachment ? toRendererSessionAttachment(attachment) : undefined
  })

  ipcMain.handle('session-attachment-rag:get-attachments', async (_event, ids: number[]) => {
    const attachments = (await listSessionAttachmentsByIds(ids ?? [])).filter(
      (attachment) => attachment.status !== 'canceled'
    )
    if (attachments.length > 0) {
      log.debug(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Get attachments: ids=${ids.join(',')}, statuses=${attachments
          .map((attachment) => `${attachment.id}:${attachment.status}`)
          .join(',')}`
      )
    }
    const embeddingModel = attachments.some((attachment) => attachment.status === 'failed')
      ? getSessionAttachmentEmbeddingModelString()
      : undefined
    return Promise.all(attachments.map((attachment) => toRendererSessionAttachment(attachment, embeddingModel)))
  })

  ipcMain.handle('session-attachment-rag:delete-message-attachments', async (_event, messageId: string) => {
    log.info(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Delete message attachments: message=${messageId}`)
    return deleteMessageAttachments(messageId)
  })

  ipcMain.handle('session-attachment-rag:delete-session-attachments', async (_event, sessionId: string) => {
    log.info(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Delete session attachments: session=${sessionId}`)
    return deleteSessionAttachments(sessionId)
  })

  ipcMain.handle(
    'session-attachment-rag:cleanup-orphans',
    async (_event, params: { sessionIds: string[]; messageIds: string[] }) => {
      log.debug(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Cleanup orphan attachments: sessions=${params.sessionIds.length}, messages=${params.messageIds.length}`
      )
      return cleanupOrphanAttachments(params.sessionIds ?? [], params.messageIds ?? [])
    }
  )

  ipcMain.handle('session-attachment-rag:retry', async (_event, attachmentId: number) => {
    log.info(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Retry attachment: attachmentId=${attachmentId}`)
    await retrySessionAttachment(attachmentId)
  })

  ipcMain.handle(
    'session-attachment-rag:rebind',
    async (_event, params: { attachmentId: number; sessionId: string; messageId: string }) => {
      log.debug(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Rebind attachment: attachmentId=${params.attachmentId}, session=${params.sessionId}, message=${params.messageId}`
      )
      await rebindSessionAttachment(params.attachmentId, params.sessionId, params.messageId)
    }
  )

  ipcMain.handle('session-attachment-rag:delete-attachment', async (_event, attachmentId: number) => {
    log.info(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Delete attachment: attachmentId=${attachmentId}`)
    await deleteSingleAttachment(attachmentId)
  })

  ipcMain.handle('session-attachment-rag:get-debug-snapshot', async () => {
    log.debug(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Get debug snapshot`)
    const snapshot = await getSessionAttachmentDebugSnapshot()
    return {
      ...snapshot,
      recentAttachments: snapshot.recentAttachments.map((attachment) => ({
        ...attachment,
        createdAt: toTimestamp(attachment.createdAt),
        processingStartedAt: toTimestamp(attachment.processingStartedAt),
        completedAt: toTimestamp(attachment.completedAt),
      })),
    }
  })

  ipcMain.handle('session-attachment-rag:clear-all', async () => {
    log.info(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Clear all session attachment rag data`)
    return clearAllSessionAttachments()
  })

  ipcMain.handle(
    'session-attachment-rag:run-maintenance',
    async (_event, params: SessionAttachmentRagMaintenanceScope) => {
      log.debug(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Run maintenance: sessions=${params.sessionIds.length}, messages=${params.messageIds.length}`
      )
      const canceledPurgedCount = await purgeCanceledSessionAttachments(50)
      const orphanDeletedIds = await cleanupOrphanAttachments(
        params.sessionIds ?? [],
        params.messageIds ?? [],
        params.attachmentReferences ?? []
      )
      return {
        interruptedFailedCount: 0,
        canceledPurgedCount,
        orphanDeletedIds,
      }
    }
  )

  ipcMain.handle(
    'session-attachment-rag:query',
    async (_event, params: { attachmentIds: number[]; query: string; plan?: SessionAttachmentQueryPlan }) => {
      const attachmentIds = [...new Set((params.attachmentIds ?? []).filter((id) => Number.isFinite(id)))]
      if (!params.query?.trim() || attachmentIds.length === 0) {
        return []
      }
      log.debug(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Query attachments: attachmentIds=${attachmentIds.join(',')}, query=${summarizeQuery(params.query)}, plan=${JSON.stringify(
          params.plan ?? {}
        )}`
      )

      const attachments = await listSessionAttachmentsByIds(attachmentIds)
      const readyAttachments = attachments.filter((attachment) => attachment.status === 'ready')
      if (readyAttachments.length === 0) {
        return []
      }

      const embeddingModel = await getSessionAttachmentEmbeddingProvider()
      const embedding = await embedMany({
        model: embeddingModel,
        values: [params.query],
        maxRetries: 0,
      })

      const vectorStore = getVectorStore()
      const queryVector = embedding.embeddings[0]
      const plan = normalizeQueryPlan(params.plan)
      log.debug(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Query normalized plan: recallTopK=${plan.recallTopK}, finalTopK=${plan.finalTopK}, rerank=${plan.rerank.enabled ? plan.rerank.model || 'enabled' : 'disabled'}`
      )
      const results = await Promise.all(
        readyAttachments.map(async (attachment) => {
          try {
            const hits = await vectorStore.query({
              indexName: `sa_${attachment.id}`,
              queryVector,
              topK: plan.recallTopK,
            })
            return hits.filter((hit) => !!hit.metadata)
          } catch (error) {
            log.warn(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Failed to query attachment ${attachment.id}:`, error)
            return []
          }
        })
      )

      const flatResults = results.flat().sort((a, b) => b.score - a.score)
      let rankedResults = flatResults

      if (plan.rerank.enabled && plan.rerank.model && flatResults.length > 0) {
        try {
          const rerankProvider = await getSessionAttachmentRerankProvider(plan.rerank.model)
          if (rerankProvider) {
            log.debug(
              `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Reranking query results with model=${plan.rerank.model}, candidates=${flatResults.length}`
            )
            const rerankedResults = await rerank(flatResults, params.query, rerankProvider, {
              topK: plan.recallTopK,
            })
            rankedResults = rerankedResults.map((item) => ({
              ...item.result,
              score: item.score,
            }))
          }
        } catch (error) {
          log.error(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Failed to rerank session attachment query`, error)
          sentry.withScope((scope) => {
            scope.setTag('component', 'session-attachment-rag')
            scope.setTag('operation', 'rerank_query')
            scope.setExtra('querySummary', summarizeQuery(params.query))
            scope.setExtra('rerankModel', plan.rerank.model)
            sentry.captureException(error)
          })
        }
      }

      const finalResults = dedupeByParent(
        rankedResults.map((hit) => ({
          attachmentId: Number(hit.metadata!.attachmentId),
          parentId: Number(hit.metadata!.parentId),
          filename: String(hit.metadata!.filename),
          sectionPath: hit.metadata!.sectionPath ? String(hit.metadata!.sectionPath) : undefined,
          chunkOrder: Number(hit.metadata!.chunkOrder),
          text: String(hit.metadata!.rawText ?? hit.metadata!.text),
          score: hit.score,
        }))
      ).slice(0, plan.finalTopK)

      log.debug(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Query completed: readyAttachments=${readyAttachments.length}, rawHits=${flatResults.length}, finalResults=${finalResults.length}`
      )

      return finalResults
    }
  )

  ipcMain.handle(
    'session-attachment-rag:read-parents',
    async (_event, params: { parentIds: number[]; attachmentIds: number[] } | number[]) => {
      // Backward-compat: legacy callers passed a bare number[] of parentIds and got no
      // session isolation. New callers pass { parentIds, attachmentIds } so we can scope
      // the query to attachments the caller is authorized to see.
      const rawParentIds = Array.isArray(params) ? params : (params?.parentIds ?? [])
      const rawAttachmentIds = Array.isArray(params) ? [] : (params?.attachmentIds ?? [])
      const ids = [...new Set(rawParentIds.filter((id) => Number.isFinite(id)))]
      const allowedAttachmentIds = [...new Set(rawAttachmentIds.filter((id) => Number.isFinite(id)))]
      log.debug(
        `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] Read parent blocks: parentIds=${ids.join(',')}, allowedAttachmentIds=${allowedAttachmentIds.join(',')}`
      )
      if (allowedAttachmentIds.length === 0) {
        log.warn(
          `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [IPC] read-parents called without attachmentIds; returning empty result to enforce session isolation`
        )
        return []
      }
      const rows = await readSessionAttachmentParents(ids, allowedAttachmentIds)
      return rows.map((row) => ({
        id: Number(row.id),
        attachmentId: Number(row.attachment_id),
        filename: String(row.filename),
        sectionPath: row.section_path ? String(row.section_path) : undefined,
        docType: row.doc_type ? String(row.doc_type) : undefined,
        pageStart: row.page_start ? Number(row.page_start) : undefined,
        pageEnd: row.page_end ? Number(row.page_end) : undefined,
        parentOrder: Number(row.parent_order),
        text: String(row.text),
        tokenEstimate: Number(row.token_estimate ?? 0),
        charCount: Number(row.char_count ?? 0),
      }))
    }
  )
}
