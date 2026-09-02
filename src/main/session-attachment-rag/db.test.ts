import fs from 'node:fs'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

const { testDir } = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  return {
    testDir: path.join(os.tmpdir(), `chatbox-session-rag-db-test-${process.pid}-${Date.now()}`),
  }
})

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

let ragDb: typeof import('./db')

beforeAll(async () => {
  fs.mkdirSync(testDir, { recursive: true })
  ragDb = await import('./db')
  await ragDb.initializeDatabase()
})

afterAll(() => {
  ragDb.getDatabase().close()
  fs.rmSync(testDir, { recursive: true, force: true })
})

describe('session attachment retry', () => {
  test('keeps the completed embedding checkpoint when the user continues a failed attachment', async () => {
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
    await ragDb.updateSessionAttachmentIndexingProgress(attachmentId, {
      indexingStage: 'embedding',
      totalChunks: 200,
      embeddedChunks: 136,
    })
    await ragDb.markSessionAttachmentFailed(attachmentId, 'ai_provider_error')

    await ragDb.retrySessionAttachment(attachmentId)

    const attachment = await ragDb.getSessionAttachment(attachmentId)
    expect(attachment).toMatchObject({
      status: 'pending',
      totalChunks: 200,
      embeddedChunks: 136,
    })

    await expect(ragDb.retrySessionAttachment(attachmentId)).rejects.toThrow(
      'Only failed session attachments can be retried'
    )
    expect(await ragDb.markSessionAttachmentIndexing(attachmentId)).toBe(true)
    await expect(ragDb.retrySessionAttachment(attachmentId)).rejects.toThrow(
      'Only failed session attachments can be retried'
    )
    expect(await ragDb.getSessionAttachment(attachmentId)).toMatchObject({ status: 'indexing' })
  })
})
