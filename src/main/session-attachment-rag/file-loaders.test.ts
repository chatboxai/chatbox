import fs from 'node:fs'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

const { embedManyMock, testDir } = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  return {
    embedManyMock: vi.fn(),
    testDir: path.join(os.tmpdir(), `chatbox-session-rag-worker-test-${process.pid}-${Date.now()}`),
  }
})

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  embedMany: embedManyMock,
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir,
  },
}))

vi.mock('../adapters/sentry', () => ({
  sentry: {
    captureException: vi.fn(),
    withScope: (callback: (scope: { setTag: () => void; setExtra: () => void }) => void) =>
      callback({ setTag: vi.fn(), setExtra: vi.fn() }),
  },
}))

vi.mock('../util', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('../store-node', () => ({
  getSettings: vi.fn(() => ({})),
  getStoreBlob: vi.fn(),
  store: {
    get: vi.fn(),
  },
}))

const EMBEDDING_MODEL = 'chatbox-ai:text-embedding-3-small'
let ragDb: typeof import('./db')
let worker: typeof import('./file-loaders')

beforeAll(async () => {
  fs.mkdirSync(testDir, { recursive: true })
  ragDb = await import('./db')
  worker = await import('./file-loaders')
  await ragDb.initializeDatabase()
})

afterAll(() => {
  ragDb?.getDatabase().close()
  fs.rmSync(testDir, { recursive: true, force: true })
})

describe('session attachment indexing worker', () => {
  test('fails a hung embedding request after the maximum wait time', async () => {
    vi.useFakeTimers()
    embedManyMock.mockImplementation(() => new Promise(() => undefined))

    try {
      const result = worker.embedManyWithRetry({} as never, ['embedding text'])
      const outcomePromise = result.then(
        () => 'resolved',
        (error: unknown) => error
      )
      await vi.advanceTimersByTimeAsync(60_001)
      const outcome = await Promise.race([outcomePromise, Promise.resolve('pending')])

      expect(outcome).toBeInstanceOf(Error)
      expect((outcome as Error).message).toContain('timed out')
    } finally {
      embedManyMock.mockReset()
      vi.useRealTimers()
    }
  })

  test('continues from the completed embedding checkpoint without reparsing the attachment', async () => {
    const attachmentId = await ragDb.createSessionAttachment({
      sessionId: 'session-1',
      messageId: 'message-1',
      attachmentStorageKey: 'storage-key-1',
      filename: 'handbook.md',
      mimeType: 'text/markdown',
      fileSize: 1024,
      tokenEstimate: 300,
    })
    expect(await ragDb.markSessionAttachmentIndexing(attachmentId)).toBe(true)

    const parentIds = await ragDb.replaceAttachmentParentsAndChunks(
      attachmentId,
      [
        {
          parentOrder: 0,
          text: 'parent text',
          tokenEstimate: 30,
          charCount: 100,
        },
      ],
      [
        {
          parentOrder: 0,
          chunkOrder: 0,
          rawText: 'already embedded',
          embeddedText: 'embedding text 0',
          tokenEstimate: 10,
        },
        {
          parentOrder: 0,
          chunkOrder: 1,
          rawText: 'remaining one',
          embeddedText: 'embedding text 1',
          tokenEstimate: 10,
        },
        {
          parentOrder: 0,
          chunkOrder: 2,
          rawText: 'remaining two',
          embeddedText: 'embedding text 2',
          tokenEstimate: 10,
        },
      ]
    )
    const indexName = `sa_${attachmentId}`
    await ragDb.getVectorStore().createIndex({ indexName, dimension: 2 })
    await ragDb.getVectorStore().upsert({
      indexName,
      ids: [`${indexName}_0`],
      vectors: [[1, 0]],
      metadata: [
        {
          attachmentId,
          parentId: parentIds.get(0),
          filename: 'handbook.md',
          chunkOrder: 0,
          text: 'embedding text 0',
          rawText: 'already embedded',
        },
      ],
    })
    await ragDb.updateSessionAttachmentIndexingProgress(attachmentId, {
      indexingStage: 'embedding',
      totalChunks: 3,
      embeddedChunks: 1,
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimension: 2,
    })
    await ragDb.markSessionAttachmentFailed(attachmentId, 'ai_provider_error')
    const failedAttachment = await ragDb.getSessionAttachment(attachmentId)
    if (!failedAttachment) throw new Error('expected failed attachment')
    expect(await worker.isSessionAttachmentCheckpointResumable(failedAttachment, EMBEDDING_MODEL)).toBe(true)
    await ragDb.retrySessionAttachment(attachmentId)

    const requestedTexts: string[] = []
    await worker.processPendingAttachmentsOnce({
      getContent: () => Promise.reject(new Error('continuation must not reload or reparse the attachment')),
      resolveEmbeddingProvider: () =>
        Promise.resolve({
          provider: {} as never,
          modelString: EMBEDDING_MODEL,
          source: 'chatbox-ai-license',
        }),
      embedValues: (_model, values) => {
        requestedTexts.push(...values)
        return Promise.resolve(values.map((_, index) => [0, index + 1]))
      },
    })

    expect(requestedTexts).toEqual(['embedding text 1', 'embedding text 2'])
    expect(await ragDb.getSessionAttachment(attachmentId)).toMatchObject({
      status: 'ready',
      totalChunks: 3,
      embeddedChunks: 3,
    })
  })

  test('rebuilds the attachment when its embedding model no longer matches the checkpoint', async () => {
    const attachmentId = await ragDb.createSessionAttachment({
      sessionId: 'session-2',
      messageId: 'message-2',
      attachmentStorageKey: 'storage-key-2',
      filename: 'notes.md',
      mimeType: 'text/markdown',
      fileSize: 512,
      tokenEstimate: 100,
    })
    expect(await ragDb.markSessionAttachmentIndexing(attachmentId)).toBe(true)
    const parentIds = await ragDb.replaceAttachmentParentsAndChunks(
      attachmentId,
      [{ parentOrder: 0, text: 'old parent', tokenEstimate: 10, charCount: 30 }],
      [
        {
          parentOrder: 0,
          chunkOrder: 0,
          rawText: 'old content',
          embeddedText: 'old embedding text',
          tokenEstimate: 10,
        },
      ]
    )
    const indexName = `sa_${attachmentId}`
    await ragDb.getVectorStore().createIndex({ indexName, dimension: 2 })
    await ragDb.getVectorStore().upsert({
      indexName,
      ids: [`${indexName}_0`],
      vectors: [[1, 0]],
      metadata: [
        {
          attachmentId,
          parentId: parentIds.get(0),
          filename: 'notes.md',
          chunkOrder: 0,
          text: 'old embedding text',
          rawText: 'old content',
        },
      ],
    })
    await ragDb.updateSessionAttachmentIndexingProgress(attachmentId, {
      indexingStage: 'embedding',
      totalChunks: 1,
      embeddedChunks: 1,
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimension: 2,
    })
    await ragDb.markSessionAttachmentFailed(attachmentId, 'ai_provider_error')
    const newEmbeddingModel = 'openai:text-embedding-3-large'
    const failedAttachment = await ragDb.getSessionAttachment(attachmentId)
    if (!failedAttachment) throw new Error('expected failed attachment')
    expect(await worker.isSessionAttachmentCheckpointResumable(failedAttachment, newEmbeddingModel)).toBe(false)
    await ragDb.retrySessionAttachment(attachmentId)

    await worker.processPendingAttachmentsOnce({
      getContent: async () => 'new source content',
      resolveEmbeddingProvider: async () => ({
        provider: {} as never,
        modelString: newEmbeddingModel,
        source: 'default-embedding-model',
      }),
      embedValues: async (_model, values) => values.map(() => [1, 0, 0]),
    })

    expect(await ragDb.getSessionAttachment(attachmentId)).toMatchObject({
      status: 'ready',
      embeddingModel: newEmbeddingModel,
      embeddingDimension: 3,
      embeddedChunks: 1,
    })
  })

  test('rebuilds the attachment when the checkpoint vector index is missing', async () => {
    const attachmentId = await ragDb.createSessionAttachment({
      sessionId: 'session-3',
      messageId: 'message-3',
      attachmentStorageKey: 'storage-key-3',
      filename: 'recovery.md',
      mimeType: 'text/markdown',
      fileSize: 256,
      tokenEstimate: 50,
    })
    expect(await ragDb.markSessionAttachmentIndexing(attachmentId)).toBe(true)
    await ragDb.replaceAttachmentParentsAndChunks(
      attachmentId,
      [{ parentOrder: 0, text: 'stale parent', tokenEstimate: 10, charCount: 30 }],
      [
        {
          parentOrder: 0,
          chunkOrder: 0,
          rawText: 'stale content',
          embeddedText: 'stale embedding text',
          tokenEstimate: 10,
        },
      ]
    )
    await ragDb.updateSessionAttachmentIndexingProgress(attachmentId, {
      indexingStage: 'embedding',
      totalChunks: 1,
      embeddedChunks: 1,
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimension: 2,
    })
    await ragDb.markSessionAttachmentFailed(attachmentId, 'Vector index is missing')
    const failedAttachment = await ragDb.getSessionAttachment(attachmentId)
    if (!failedAttachment) throw new Error('expected failed attachment')
    expect(await worker.isSessionAttachmentCheckpointResumable(failedAttachment, EMBEDDING_MODEL)).toBe(false)
    await ragDb.retrySessionAttachment(attachmentId)

    await worker.processPendingAttachmentsOnce({
      getContent: async () => 'recovered source content',
      resolveEmbeddingProvider: async () => ({
        provider: {} as never,
        modelString: EMBEDDING_MODEL,
        source: 'chatbox-ai-license',
      }),
      embedValues: async (_model, values) => values.map(() => [0, 1]),
    })

    expect(await ragDb.getSessionAttachment(attachmentId)).toMatchObject({
      status: 'ready',
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimension: 2,
      embeddedChunks: 1,
    })
  })
})
