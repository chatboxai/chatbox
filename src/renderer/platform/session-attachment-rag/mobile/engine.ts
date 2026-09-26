import type { EmbeddingModel } from 'ai'
import {
  dedupeByParent,
  normalizeQueryPlan,
} from '@shared/session-attachment-rag/query-plan'
import { MobileRagDatabase } from './db'
import {
  embedManyWithRetry,
  getMobileEmbeddingModelString,
  resolveMobileEmbeddingProvider,
} from './embedding'
import { type IndexerDependencies, MobileRagIndexer } from './indexer'
import type {
  CreateSessionAttachmentParams,
  SessionAttachment,
  SessionAttachmentParent,
  SessionAttachmentQueryPlan,
  SessionAttachmentRagDebugSnapshot,
  SessionAttachmentRagMaintenanceResult,
  SessionAttachmentRagMaintenanceScope,
  SessionAttachmentRecord,
  SessionAttachmentSearchResult,
} from './types'
import { SQLiteBlobVectorStore } from './vector-store'

export interface MobileEngineDependencies {
  database?: MobileRagDatabase
  vectorStore?: SQLiteBlobVectorStore
  indexer?: MobileRagIndexer
  indexerDeps?: IndexerDependencies
  resolveEmbeddingProvider?: (modelString?: string) => Promise<{ provider: EmbeddingModel; modelString: string }>
  embedValues?: (model: EmbeddingModel, values: string[]) => Promise<number[][]>
}

export class MobileLocalRagEngine {
  public readonly database: MobileRagDatabase
  public readonly vectorStore: SQLiteBlobVectorStore
  public readonly indexer: MobileRagIndexer
  private queue: Promise<void> = Promise.resolve()
  private resolveEmbedding: (modelString?: string) => Promise<{ provider: EmbeddingModel; modelString: string }>
  private embedValues: (model: EmbeddingModel, values: string[]) => Promise<number[][]>

  constructor(dependencies: MobileEngineDependencies = {}) {
    this.database = dependencies.database ?? new MobileRagDatabase()
    this.vectorStore = dependencies.vectorStore ?? new SQLiteBlobVectorStore(this.database)
    this.indexer =
      dependencies.indexer ??
      new MobileRagIndexer(this.database, this.vectorStore, dependencies.indexerDeps)
    this.resolveEmbedding = dependencies.resolveEmbeddingProvider ?? resolveMobileEmbeddingProvider
    this.embedValues = dependencies.embedValues ?? embedManyWithRetry
  }

  public async initialize(): Promise<void> {
    await this.database.initialize()
  }

  public enqueueIndexing(attachmentId: number): void {
    this.queue = this.queue
      .then(async () => {
        try {
          await this.indexer.indexAttachment(attachmentId)
        } catch (error) {
          console.warn(`[MobileLocalRagEngine] Failed to index attachment ${attachmentId}:`, error)
        }
      })
      .catch(() => undefined)
  }

  public async createAttachment(params: CreateSessionAttachmentParams): Promise<SessionAttachment> {
    await this.initialize()
    const id = await this.database.createAttachment(params)
    this.enqueueIndexing(id)

    const record = await this.database.getAttachment(id)
    return this.toSessionAttachment(record ?? {
      id,
      sessionId: params.sessionId,
      messageId: params.messageId,
      attachmentStorageKey: params.attachmentStorageKey,
      filename: params.filename,
      mimeType: params.mimeType,
      fileSize: params.fileSize,
      tokenEstimate: params.tokenEstimate,
      status: 'pending',
      indexingStage: 'queued',
      createdAt: String(Date.now()),
    })
  }

  public async getAttachments(ids: number[]): Promise<SessionAttachment[]> {
    await this.initialize()
    const records = await this.database.getAttachments(ids)
    const currentModel = getMobileEmbeddingModelString()

    return Promise.all(
      records.map(async (record) => {
        const resumable =
          record.status === 'failed' && currentModel
            ? await this.indexer.isCheckpointResumable(record, currentModel)
            : false
        return this.toSessionAttachment(record, resumable)
      })
    )
  }

  public async retryAttachment(attachmentId: number): Promise<void> {
    await this.initialize()
    await this.database.markAttachmentStatus(attachmentId, 'pending')
    this.enqueueIndexing(attachmentId)
  }

  public async rebindAttachment(params: {
    attachmentId: number
    sessionId: string
    messageId: string
  }): Promise<void> {
    await this.initialize()
    await this.database.rebindAttachment(params.attachmentId, params.sessionId, params.messageId)
  }

  public async deleteAttachment(attachmentId: number): Promise<void> {
    await this.initialize()
    this.indexer.cancel(attachmentId)
    await this.database.deleteAttachment(attachmentId)
  }

  public async deleteMessageAttachments(messageId: string): Promise<number[]> {
    await this.initialize()
    const rows = await this.database.getDatabase().query('SELECT id FROM session_attachment WHERE message_id = ?', [messageId])
    const ids = (rows.values ?? []).map((r) => Number(r.id))
    for (const id of ids) {
      this.indexer.cancel(id)
    }
    return this.database.deleteMessageAttachments(messageId)
  }

  public async deleteSessionAttachments(sessionId: string): Promise<number[]> {
    await this.initialize()
    const rows = await this.database.getDatabase().query('SELECT id FROM session_attachment WHERE session_id = ?', [sessionId])
    const ids = (rows.values ?? []).map((r) => Number(r.id))
    for (const id of ids) {
      this.indexer.cancel(id)
    }
    return this.database.deleteSessionAttachments(sessionId)
  }

  public async cleanupOrphans(params: {
    sessionIds: string[]
    messageIds: string[]
  }): Promise<number[]> {
    await this.initialize()
    return this.database.cleanupOrphans(params.sessionIds, params.messageIds)
  }

  public async getDebugSnapshot(): Promise<SessionAttachmentRagDebugSnapshot> {
    await this.initialize()
    return this.database.getDebugSnapshot()
  }

  public async clearAll(): Promise<number> {
    await this.initialize()
    return this.database.clearAll()
  }

  public async runMaintenance(
    params: SessionAttachmentRagMaintenanceScope
  ): Promise<SessionAttachmentRagMaintenanceResult> {
    await this.initialize()
    const orphanDeletedIds = await this.database.cleanupOrphans(
      params.sessionIds ?? [],
      params.messageIds ?? [],
      params.attachmentReferences ?? []
    )
    return {
      interruptedFailedCount: 0,
      canceledPurgedCount: 0,
      orphanDeletedIds,
    }
  }

  public async query(params: {
    attachmentIds: number[]
    query: string
    plan: SessionAttachmentQueryPlan
  }): Promise<SessionAttachmentSearchResult[]> {
    const attachmentIds = [...new Set((params.attachmentIds ?? []).filter((id) => Number.isFinite(id)))]
    if (!params.query?.trim() || attachmentIds.length === 0) {
      return []
    }

    await this.initialize()
    const attachments = await this.database.getAttachments(attachmentIds)
    const readyAttachments = attachments.filter((a) => a.status === 'ready')
    if (readyAttachments.length === 0) {
      return []
    }

    const readyIds = readyAttachments.map((a) => a.id)
    const plan = normalizeQueryPlan(params.plan)

    // Generate query embedding
    const { provider } = await this.resolveEmbedding()
    const embeddings = await this.embedValues(provider, [params.query])
    const queryVector = embeddings[0]

    // Recall top hits from vector store
    const hits = await this.vectorStore.query({
      attachmentIds: readyIds,
      queryVector,
      topK: plan.recallTopK,
    })

    if (hits.length === 0) {
      return []
    }

    const chunkIds = hits.map((h) => h.chunkId)
    const chunks = await this.database.listChunksWithDetails(chunkIds)
    const chunkMap = new Map(chunks.map((c) => [c.id, c]))

    const scoredResults = hits
      .map((hit) => {
        const chunk = chunkMap.get(hit.chunkId)
        if (!chunk) return null
        return {
          attachmentId: chunk.attachmentId,
          parentId: chunk.parentId,
          filename: chunk.filename,
          sectionPath: chunk.sectionPath,
          chunkOrder: chunk.chunkOrder,
          text: chunk.rawText,
          score: hit.score,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    // Dedupe by parent ID and take final Top K
    const finalResults = dedupeByParent(scoredResults).slice(0, plan.finalTopK)
    return finalResults
  }

  public async readParents(params: {
    parentIds: number[]
    attachmentIds: number[]
  }): Promise<SessionAttachmentParent[]> {
    const parentIds = [...new Set((params.parentIds ?? []).filter((id) => Number.isFinite(id)))]
    const allowedAttachmentIds = [
      ...new Set((params.attachmentIds ?? []).filter((id) => Number.isFinite(id))),
    ]
    if (parentIds.length === 0 || allowedAttachmentIds.length === 0) {
      return []
    }

    await this.initialize()
    const parents = await this.database.readParents(parentIds, allowedAttachmentIds)

    return parents.map((p) => ({
      id: p.id,
      attachmentId: p.attachmentId,
      filename: (p as { filename?: string }).filename ?? '',
      sectionPath: p.sectionPath,
      docType: p.docType,
      pageStart: p.pageStart,
      pageEnd: p.pageEnd,
      parentOrder: p.parentOrder,
      text: p.text,
      tokenEstimate: p.tokenEstimate,
      charCount: p.charCount,
    }))
  }

  private toSessionAttachment(
    record: SessionAttachmentRecord,
    resumable = false
  ): SessionAttachment {
    return {
      id: record.id,
      sessionId: record.sessionId,
      messageId: record.messageId,
      attachmentStorageKey: record.attachmentStorageKey,
      filename: record.filename,
      mimeType: record.mimeType,
      fileSize: record.fileSize,
      tokenEstimate: record.tokenEstimate,
      chunkCount: record.totalChunks ?? 0,
      totalChunks: record.totalChunks ?? 0,
      embeddedChunks: record.embeddedChunks ?? 0,
      embeddingModel: record.embeddingModel,
      embeddingDimension: record.embeddingDimension,
      indexingStage: record.indexingStage,
      parserType: record.parserType,
      availability: 'allowed',
      indexStatus: record.status === 'canceled' ? 'failed' : record.status,
      status: record.status === 'canceled' ? 'failed' : record.status,
      resumable,
      error: record.error,
      createdAt: record.createdAt ? Number(record.createdAt) : undefined,
      processingStartedAt: record.processingStartedAt ? Number(record.processingStartedAt) : undefined,
      completedAt: record.completedAt ? Number(record.completedAt) : undefined,
    }
  }
}
