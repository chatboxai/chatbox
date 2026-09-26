import type {
  SessionAttachment,
  SessionAttachmentParent,
  SessionAttachmentQueryPlan,
  SessionAttachmentRagDebugSnapshot,
  SessionAttachmentRagMaintenanceResult,
  SessionAttachmentRagMaintenanceScope,
  SessionAttachmentSearchResult,
} from '@shared/types'
import platform from '@/platform'
import { chunkMobileDocument } from './chunking'
import { MobileRagDatabase } from './db'
import { SQLiteBlobVectorStore } from './vector-store'

export interface MobileRagEngineOptions {
  database?: MobileRagDatabase
  vectorStore?: SQLiteBlobVectorStore
  resolveEmbedding?: () => Promise<{ provider: any; modelString: string }>
  embedValues?: (provider: any, values: string[]) => Promise<number[][]>
  loadContent?: (storageKey: string) => Promise<string>
}

export class MobileLocalRagEngine {
  private database: MobileRagDatabase
  private vectorStore: SQLiteBlobVectorStore
  private resolveEmbeddingImpl?: () => Promise<{ provider: any; modelString: string }>
  private embedValuesImpl?: (provider: any, values: string[]) => Promise<number[][]>
  private loadContentImpl?: (storageKey: string) => Promise<string>

  constructor(options: MobileRagEngineOptions = {}) {
    this.database = options.database ?? new MobileRagDatabase()
    this.vectorStore = options.vectorStore ?? new SQLiteBlobVectorStore(this.database)
    this.resolveEmbeddingImpl = options.resolveEmbedding
    this.embedValuesImpl = options.embedValues
    this.loadContentImpl = options.loadContent
  }

  async createAttachment(params: {
    sessionId: string
    messageId: string
    attachmentStorageKey: string
    filename: string
    mimeType?: string
    fileSize: number
    tokenEstimate: number
    parserType?: string
  }): Promise<SessionAttachment> {
    const attachment = await this.database.createAttachment(params)
    // Run background indexing
    void this.indexAttachment(attachment.id, params.attachmentStorageKey)
    return attachment
  }

  async indexAttachment(attachmentId: number, storageKey: string): Promise<void> {
    try {
      await this.database.markIndexing(attachmentId)

      let content = ''
      if (this.loadContentImpl) {
        content = await this.loadContentImpl(storageKey)
      } else {
        const blob = await platform.getBlob(storageKey)
        if (!blob) {
          throw new Error(`Attachment blob not found for key: ${storageKey}`)
        }
        content = await blob.text()
      }

      if (!content.trim()) {
        await this.database.markReady(attachmentId, { totalChunks: 0 })
        return
      }

      const { parents, children } = chunkMobileDocument(content)
      const { createdChunks } = await this.database.insertParentsAndChunks(attachmentId, parents, children)

      if (createdChunks.length === 0) {
        await this.database.markReady(attachmentId, { totalChunks: 0 })
        return
      }

      const { provider, modelString } = await this.resolveEmbedding()
      const batchSize = 30
      let dimension = 0

      for (let i = 0; i < createdChunks.length; i += batchSize) {
        const batch = createdChunks.slice(i, i + batchSize)
        const texts = batch.map((c) => c.text)
        const vectors = await this.embedValues(provider, texts)

        if (vectors.length > 0 && dimension === 0) {
          dimension = vectors[0].length
        }

        const records = batch.map((c, idx) => ({
          chunkId: c.id,
          attachmentId,
          vector: vectors[idx],
        }))

        await this.vectorStore.upsert(records)
      }

      await this.database.markReady(attachmentId, {
        totalChunks: createdChunks.length,
        model: modelString,
        dimension,
      })
    } catch (error) {
      console.error(`[MobileLocalRagEngine] Indexing failed for attachment ${attachmentId}:`, error)
      await this.database.markFailed(attachmentId, error instanceof Error ? error.message : String(error))
    }
  }

  async getAttachments(ids: number[]): Promise<SessionAttachment[]> {
    return this.database.getAttachments(ids)
  }

  async retryAttachment(attachmentId: number): Promise<void> {
    const attachments = await this.database.getAttachments([attachmentId])
    if (attachments.length === 0) return
    await this.database.retryAttachment(attachmentId)
    // Query storage key from DB
    const res = await this.database.getDatabase().query(
      'SELECT storage_key FROM session_attachments WHERE id = ?;',
      [attachmentId]
    )
    const storageKey = res.values?.[0]?.storage_key
    if (storageKey) {
      void this.indexAttachment(attachmentId, storageKey)
    }
  }

  async rebindAttachment(params: { attachmentId: number; sessionId: string; messageId: string }): Promise<void> {
    return this.database.rebindAttachment(params)
  }

  async deleteAttachment(attachmentId: number): Promise<void> {
    return this.database.deleteAttachment(attachmentId)
  }

  async deleteMessageAttachments(messageId: string): Promise<number[]> {
    return this.database.deleteMessageAttachments(messageId)
  }

  async deleteSessionAttachments(sessionId: string): Promise<number[]> {
    return this.database.deleteSessionAttachments(sessionId)
  }

  async cleanupOrphans(params: { sessionIds: string[]; messageIds: string[] }): Promise<number[]> {
    return this.database.cleanupOrphans(params)
  }

  async clearAll(): Promise<number> {
    return this.database.clearAll()
  }

  async runMaintenance(params: SessionAttachmentRagMaintenanceScope): Promise<SessionAttachmentRagMaintenanceResult> {
    return this.database.runMaintenance(params)
  }

  async getDebugSnapshot(): Promise<SessionAttachmentRagDebugSnapshot> {
    return this.database.getDebugSnapshot()
  }

  async query(params: {
    attachmentIds: number[]
    query: string
    plan: SessionAttachmentQueryPlan
  }): Promise<SessionAttachmentSearchResult[]> {
    const attachmentIds = params.attachmentIds.filter((id) => Number.isFinite(id))
    if (!params.query.trim() || attachmentIds.length === 0) {
      return []
    }

    const attachments = await this.database.getAttachments(attachmentIds)
    const readyAttachments = attachments.filter((a) => a.status === 'ready')
    if (readyAttachments.length === 0) {
      return []
    }

    const readyIds = readyAttachments.map((a) => a.id)
    const filenameMap = new Map(readyAttachments.map((a) => [a.id, a.filename]))

    const { provider } = await this.resolveEmbedding()
    const [queryVector] = await this.embedValues(provider, [params.query])

    const recallTopK = Math.max(params.plan.recallTopK || 20, 10)
    const finalTopK = Math.max(params.plan.finalTopK || 8, 1)

    const hits = await this.vectorStore.query({
      attachmentIds: readyIds,
      queryVector,
      topK: recallTopK,
    })

    if (hits.length === 0) {
      return []
    }

    const chunkIds = hits.map((h) => h.chunkId)
    const chunks = await this.database.getChunksByIds(chunkIds)
    const chunkMap = new Map(chunks.map((c) => [c.id, c]))

    const results: SessionAttachmentSearchResult[] = []

    for (const hit of hits) {
      const chunk = chunkMap.get(hit.chunkId)
      if (!chunk) continue

      results.push({
        attachmentId: hit.attachmentId,
        parentId: chunk.parentId,
        filename: filenameMap.get(hit.attachmentId) || '',
        chunkOrder: chunk.chunkOrder,
        text: chunk.rawText,
        score: hit.score,
      })
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, finalTopK)
  }

  async readParents(params: { parentIds: number[]; attachmentIds: number[] }): Promise<SessionAttachmentParent[]> {
    return this.database.readParents(params.parentIds, params.attachmentIds)
  }

  private async resolveEmbedding(): Promise<{ provider: any; modelString: string }> {
    if (this.resolveEmbeddingImpl) {
      return this.resolveEmbeddingImpl()
    }
    // Dynamic import to avoid cycles
    const { getSessionAttachmentEmbeddingProvider } = await import(
      '../../packages/model-calls/session-attachment-rag-embedding'
    )
    const provider = await getSessionAttachmentEmbeddingProvider()
    return { provider, modelString: 'default' }
  }

  private async embedValues(provider: any, values: string[]): Promise<number[][]> {
    if (this.embedValuesImpl) {
      return this.embedValuesImpl(provider, values)
    }
    const { embedMany } = await import('ai')
    const res = await embedMany({
      model: provider,
      values,
      maxRetries: 1,
    })
    return res.embeddings
  }
}
