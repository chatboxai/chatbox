import type { EmbeddingModel } from 'ai'
import {
  buildAttachmentChunks,
  buildEmbeddedText,
  selectAttachmentChunkingPipeline,
} from '@shared/session-attachment-rag/chunking'
import type { MobileRagDatabase } from './db'
import {
  embedManyWithRetry,
  resolveMobileEmbeddingProvider,
  validateEmbeddingBatch,
} from './embedding'
import type { SQLiteBlobVectorStore } from './vector-store'
import type {
  SessionAttachmentChunkRecord,
  SessionAttachmentRecord,
} from './types'

const BATCH_SIZE = 50

export interface IndexerDependencies {
  getContent: (storageKey: string) => Promise<string | null | undefined>
  resolveEmbeddingProvider: (modelString?: string) => Promise<{ provider: EmbeddingModel; modelString: string }>
  embedValues: (model: EmbeddingModel, values: string[]) => Promise<number[][]>
}

const defaultDependencies: IndexerDependencies = {
  getContent: async (key: string) => {
    const { default: storage } = await import('@/storage')
    return (await storage.getBlob(key).catch(() => null)) ?? null
  },
  resolveEmbeddingProvider: resolveMobileEmbeddingProvider,
  embedValues: (model, values) => embedManyWithRetry(model, values),
}

export class MobileRagIndexer {
  private canceledAttachmentIds = new Set<number>()

  constructor(
    private database: MobileRagDatabase,
    private vectorStore: SQLiteBlobVectorStore,
    private deps: IndexerDependencies = defaultDependencies
  ) {}

  public cancel(attachmentId: number): void {
    this.canceledAttachmentIds.add(attachmentId)
  }

  private isCanceled(attachmentId: number): boolean {
    return this.canceledAttachmentIds.has(attachmentId)
  }

  private clearCanceled(attachmentId: number): void {
    this.canceledAttachmentIds.delete(attachmentId)
  }

  public async isCheckpointResumable(
    attachment: SessionAttachmentRecord,
    currentEmbeddingModel: string
  ): Promise<boolean> {
    const totalChunks = attachment.totalChunks ?? 0
    const embeddedChunks = attachment.embeddedChunks ?? 0
    const embeddingDimension = attachment.embeddingDimension ?? 0

    if (
      totalChunks <= 0 ||
      embeddedChunks <= 0 ||
      embeddedChunks > totalChunks ||
      attachment.embeddingModel !== currentEmbeddingModel ||
      embeddingDimension <= 0
    ) {
      return false
    }

    const hasVectors = await this.vectorStore.hasAttachmentVectorIndex(attachment.id)
    if (!hasVectors) return false

    const chunks = await this.database.listChunks(attachment.id)
    return chunks.length === totalChunks
  }

  public async indexAttachment(attachmentId: number): Promise<void> {
    if (this.isCanceled(attachmentId)) {
      await this.database.markAttachmentStatus(attachmentId, 'canceled')
      this.clearCanceled(attachmentId)
      return
    }

    const attachment = await this.database.getAttachment(attachmentId)
    if (!attachment) {
      throw new Error(`Attachment ${attachmentId} not found`)
    }

    try {
      await this.database.markAttachmentStatus(attachmentId, 'indexing')

      if (this.isCanceled(attachmentId)) {
        await this.database.markAttachmentStatus(attachmentId, 'canceled')
        this.clearCanceled(attachmentId)
        return
      }

      const embeddingResolution = await this.deps.resolveEmbeddingProvider()
      const canResume = await this.isCheckpointResumable(attachment, embeddingResolution.modelString)

      if (canResume) {
        await this.resumeIndexing(attachment, embeddingResolution.provider, embeddingResolution.modelString)
      } else {
        await this.indexFromScratch(attachment, embeddingResolution.provider, embeddingResolution.modelString)
      }

      if (this.isCanceled(attachmentId)) {
        await this.database.markAttachmentStatus(attachmentId, 'canceled')
        this.clearCanceled(attachmentId)
        return
      }

      await this.database.markAttachmentStatus(attachmentId, 'ready')
    } catch (error) {
      if (this.isCanceled(attachmentId)) {
        await this.database.markAttachmentStatus(attachmentId, 'canceled')
        this.clearCanceled(attachmentId)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      await this.database.markAttachmentStatus(attachmentId, 'failed', message)
      throw error
    }
  }

  private async indexFromScratch(
    attachment: SessionAttachmentRecord,
    embeddingModel: EmbeddingModel,
    embeddingModelString: string
  ): Promise<void> {
    const content = await this.deps.getContent(attachment.attachmentStorageKey)
    if (!content?.trim()) {
      throw new Error('Attachment content not found or empty')
    }

    if (this.isCanceled(attachment.id)) return

    await this.database.updateAttachmentProgress(attachment.id, {
      indexingStage: 'chunking',
    })

    const { parents, children } = await buildAttachmentChunks(content, attachment.filename)
    if (parents.length === 0 || children.length === 0) {
      throw new Error('Attachment produced no chunks')
    }

    if (this.isCanceled(attachment.id)) return

    // Clean previous vectors and replace chunks in DB
    await this.vectorStore.deleteIndex(attachment.id)

    const parentPayload = parents.map((p) => ({
      parentOrder: p.parentOrder,
      sectionPath: p.sectionPath,
      docType: attachment.mimeType,
      text: p.text,
      tokenEstimate: p.tokenEstimate,
      charCount: p.charCount,
    }))

    const chunkPayload = children.map((c) => ({
      parentOrder: c.parentOrder,
      chunkOrder: c.chunkOrder,
      sectionPath: c.sectionPath,
      rawText: c.rawText,
      embeddedText: buildEmbeddedText({
        filename: attachment.filename,
        sectionPath: c.sectionPath,
        text: c.rawText,
      }),
      tokenEstimate: c.tokenEstimate,
    }))

    const chunkIds = await this.database.replaceParentsAndChunks(attachment.id, parentPayload, chunkPayload)

    if (this.isCanceled(attachment.id)) return

    // Embed first chunk to inspect and validate dimension
    const firstChunkText = chunkPayload[0].embeddedText
    const firstEmbeddings = await this.deps.embedValues(embeddingModel, [firstChunkText])
    validateEmbeddingBatch(firstEmbeddings, 1)
    const embeddingDimension = firstEmbeddings[0].length

    await this.database.updateAttachmentProgress(attachment.id, {
      indexingStage: 'embedding',
      totalChunks: children.length,
      embeddedChunks: 0,
      embeddingModel: embeddingModelString,
      embeddingDimension,
    })

    // Prepare all chunks with their generated DB ids
    const chunksWithIds: SessionAttachmentChunkRecord[] = chunkPayload.map((c, i) => ({
      id: chunkIds[i],
      attachmentId: attachment.id,
      parentId: 0,
      chunkOrder: c.chunkOrder,
      sectionPath: c.sectionPath,
      rawText: c.rawText,
      embeddedText: c.embeddedText,
      tokenEstimate: c.tokenEstimate,
    }))

    await this.embedChunksInBatches({
      attachmentId: attachment.id,
      chunks: chunksWithIds,
      startIndex: 0,
      embeddingModel,
      embeddingDimension,
      firstEmbeddingPrefetched: firstEmbeddings[0],
    })
  }

  private async resumeIndexing(
    attachment: SessionAttachmentRecord,
    embeddingModel: EmbeddingModel,
    embeddingModelString: string
  ): Promise<void> {
    const chunks = await this.database.listChunks(attachment.id)
    const startIndex = attachment.embeddedChunks ?? 0
    const dimension = attachment.embeddingDimension ?? 0

    await this.database.updateAttachmentProgress(attachment.id, {
      indexingStage: 'embedding',
      totalChunks: chunks.length,
      embeddedChunks: startIndex,
      embeddingModel: embeddingModelString,
    })

    await this.embedChunksInBatches({
      attachmentId: attachment.id,
      chunks,
      startIndex,
      embeddingModel,
      embeddingDimension: dimension,
    })
  }

  private async embedChunksInBatches(params: {
    attachmentId: number
    chunks: SessionAttachmentChunkRecord[]
    startIndex: number
    embeddingModel: EmbeddingModel
    embeddingDimension: number
    firstEmbeddingPrefetched?: number[]
  }): Promise<void> {
    const { attachmentId, chunks, startIndex, embeddingModel, embeddingDimension, firstEmbeddingPrefetched } =
      params

    for (let i = startIndex; i < chunks.length; i += BATCH_SIZE) {
      if (this.isCanceled(attachmentId)) return

      const batchChunks = chunks.slice(i, i + BATCH_SIZE)
      const batchTexts = batchChunks.map((c) => c.embeddedText)
      let embeddings: number[][]

      if (i === 0 && firstEmbeddingPrefetched) {
        if (batchTexts.length === 1) {
          embeddings = [firstEmbeddingPrefetched]
        } else {
          const rest = await this.deps.embedValues(embeddingModel, batchTexts.slice(1))
          embeddings = [firstEmbeddingPrefetched, ...rest]
        }
      } else {
        embeddings = await this.deps.embedValues(embeddingModel, batchTexts)
      }

      validateEmbeddingBatch(embeddings, batchChunks.length, embeddingDimension)

      if (this.isCanceled(attachmentId)) return

      const vectorRecords = batchChunks.map((chunk, idx) => ({
        chunkId: chunk.id,
        attachmentId,
        vector: embeddings[idx],
      }))

      await this.vectorStore.upsert(vectorRecords)

      const embeddedCount = Math.min(i + batchChunks.length, chunks.length)
      await this.database.updateAttachmentProgress(attachmentId, {
        indexingStage: 'embedding',
        totalChunks: chunks.length,
        embeddedChunks: embeddedCount,
      })

      // Yield event loop so UI does not freeze during batch embedding
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    await this.database.updateAttachmentProgress(attachmentId, {
      indexingStage: 'finalizing',
    })
  }
}
