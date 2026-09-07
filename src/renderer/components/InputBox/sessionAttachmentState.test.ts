import type { SessionAttachment } from '@shared/types'
import { describe, expect, test } from 'vitest'
import type { PreprocessedFile } from '@/types/input-box'
import { mergeSessionAttachmentStatesIntoFiles, shouldRefetchSessionAttachmentStates } from './sessionAttachmentState'

function attachment(overrides: Partial<SessionAttachment>): SessionAttachment {
  return {
    id: 33,
    sessionId: 'session-1',
    messageId: 'message-1',
    attachmentStorageKey: 'file-key',
    filename: 'large.txt',
    mimeType: 'text/plain',
    fileSize: 1024,
    tokenEstimate: 100,
    availability: 'allowed',
    indexStatus: 'pending',
    status: 'pending',
    ...overrides,
  }
}

describe('input session attachment state', () => {
  test('clears the stale failure while preserving the checkpoint when continuation is queued', () => {
    const file = {
      file: {} as File,
      content: 'content',
      storageKey: 'file-key',
      ragMode: 'session-retrieval',
      sessionAttachmentId: 33,
      sessionAttachmentIndexStatus: 'failed',
      sessionAttachmentTotalChunks: 250,
      sessionAttachmentEmbeddedChunks: 50,
      error: 'ai_provider_error',
    } satisfies PreprocessedFile

    const result = mergeSessionAttachmentStatesIntoFiles(
      [file],
      [attachment({ totalChunks: 250, embeddedChunks: 50, resumable: true, error: undefined })]
    )

    expect(result.changed).toBe(true)
    expect(result.files[0]).toMatchObject({
      sessionAttachmentIndexStatus: 'pending',
      sessionAttachmentTotalChunks: 250,
      sessionAttachmentEmbeddedChunks: 50,
      sessionAttachmentResumable: true,
    })
    expect(result.files[0].error).toBeUndefined()
  })

  test('keeps polling until every local attachment reaches a terminal state', () => {
    expect(shouldRefetchSessionAttachmentStates([], 1)).toBe(true)
    expect(shouldRefetchSessionAttachmentStates([attachment({ indexStatus: 'indexing' })], 1)).toBe(true)
    expect(shouldRefetchSessionAttachmentStates([attachment({ indexStatus: 'ready' })], 1)).toBe(false)
    expect(shouldRefetchSessionAttachmentStates([attachment({ indexStatus: 'failed' })], 1)).toBe(false)
  })
})
