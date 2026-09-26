import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type IndexerDependencies, MobileRagIndexer } from '../indexer'

describe('MobileRagIndexer', () => {
  let mockDb: any
  let mockVectorStore: any
  let mockDeps: IndexerDependencies
  let indexer: MobileRagIndexer

  const mockAttachment = {
    id: 1,
    sessionId: 'sess_1',
    messageId: 'msg_1',
    attachmentStorageKey: 'blob_1',
    filename: 'test.md',
    mimeType: 'text/markdown',
    fileSize: 500,
    tokenEstimate: 120,
    status: 'pending' as const,
    indexingStage: 'queued' as const,
    totalChunks: 0,
    embeddedChunks: 0,
  }

  beforeEach(() => {
    mockDb = {
      getAttachment: vi.fn().mockResolvedValue({ ...mockAttachment }),
      markAttachmentStatus: vi.fn().mockResolvedValue(undefined),
      updateAttachmentProgress: vi.fn().mockResolvedValue(undefined),
      replaceParentsAndChunks: vi.fn().mockResolvedValue([101, 102]),
      listChunks: vi.fn().mockResolvedValue([
        { id: 101, attachmentId: 1, chunkOrder: 0, embeddedText: 'chunk 0', rawText: 'chunk 0' },
        { id: 102, attachmentId: 1, chunkOrder: 1, embeddedText: 'chunk 1', rawText: 'chunk 1' },
      ]),
    }

    mockVectorStore = {
      deleteIndex: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
      hasAttachmentVectorIndex: vi.fn().mockResolvedValue(true),
    }

    mockDeps = {
      getContent: vi.fn().mockResolvedValue('# Title\nFirst paragraph.\n\n## Section 2\nSecond paragraph.'),
      resolveEmbeddingProvider: vi.fn().mockResolvedValue({
        provider: {} as any,
        modelString: 'openai:text-embedding-3-small',
      }),
      embedValues: vi.fn().mockImplementation(async (_model, values: string[]) => {
        return values.map(() => [0.1, 0.2, 0.3])
      }),
    }

    indexer = new MobileRagIndexer(mockDb, mockVectorStore, mockDeps)
  })

  it('indexes an attachment from scratch through chunking, embedding, and vector upsert', async () => {
    await indexer.indexAttachment(1)

    // Stage 1: mark indexing
    expect(mockDb.markAttachmentStatus).toHaveBeenCalledWith(1, 'indexing')
    // Stage 2: chunking
    expect(mockDb.updateAttachmentProgress).toHaveBeenCalledWith(1, { indexingStage: 'chunking' })
    expect(mockDb.replaceParentsAndChunks).toHaveBeenCalledTimes(1)
    // Stage 3: embedding progress updated
    expect(mockDb.updateAttachmentProgress).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        indexingStage: 'embedding',
        embeddingModel: 'openai:text-embedding-3-small',
        embeddingDimension: 3,
      })
    )
    // Stage 4: vectors upserted
    expect(mockVectorStore.upsert).toHaveBeenCalled()
    // Stage 5: mark ready
    expect(mockDb.markAttachmentStatus).toHaveBeenCalledWith(1, 'ready')
  })

  it('continues indexing from checkpoint when resumable', async () => {
    mockDb.getAttachment.mockResolvedValueOnce({
      ...mockAttachment,
      status: 'failed',
      totalChunks: 2,
      embeddedChunks: 1,
      embeddingModel: 'openai:text-embedding-3-small',
      embeddingDimension: 3,
    })

    await indexer.indexAttachment(1)

    // Should not re-chunk
    expect(mockDb.replaceParentsAndChunks).not.toHaveBeenCalled()
    // Should embed the remaining chunk (starting at index 1)
    expect(mockDeps.embedValues).toHaveBeenCalledTimes(1)
    expect(mockDeps.embedValues).toHaveBeenCalledWith(expect.anything(), ['chunk 1'])
    // Should mark ready
    expect(mockDb.markAttachmentStatus).toHaveBeenCalledWith(1, 'ready')
  })

  it('re-indexes from scratch when embedding model has changed', async () => {
    mockDb.getAttachment.mockResolvedValueOnce({
      ...mockAttachment,
      status: 'failed',
      totalChunks: 2,
      embeddedChunks: 1,
      embeddingModel: 'old-model:text-embedding-v1', // different model!
      embeddingDimension: 3,
    })

    await indexer.indexAttachment(1)

    // Since model changed, must re-chunk from scratch
    expect(mockDb.replaceParentsAndChunks).toHaveBeenCalledTimes(1)
    expect(mockDb.updateAttachmentProgress).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        embeddingModel: 'openai:text-embedding-3-small',
      })
    )
    expect(mockDb.markAttachmentStatus).toHaveBeenCalledWith(1, 'ready')
  })

  it('handles cancellation cleanly', async () => {
    indexer.cancel(1)
    await indexer.indexAttachment(1)

    expect(mockDb.markAttachmentStatus).toHaveBeenCalledWith(1, 'canceled')
    expect(mockDb.markAttachmentStatus).not.toHaveBeenCalledWith(1, 'ready')
  })
})
