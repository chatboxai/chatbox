import {
  SESSION_TEXT_TOKEN_VERSION,
  type SessionMessagesSource,
  type SessionTextTokenSource,
} from '@chatbox/core/ports'
import type { Message } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import { computationQueue } from '../computation-queue'
import { estimateDraftTokensImmediately, getTokenizationTextDigest } from '../draft-tokenization'
import { _resetExactTokenizationFallbacks, getExactTokenizationFallbackCount } from '../exact-retry'
import { executeTask, initializeExecutor, setResultPersister } from '../task-executor'
import type { ComputationTask } from '../types'

const { readMessagesMock, tokenizeDraftMock } = vi.hoisted(() => ({
  readMessagesMock: vi.fn(),
  tokenizeDraftMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessions: { readSessionMessages: readMessagesMock } },
}))

vi.mock('../draft-tokenizer-worker-client', () => ({
  tokenizeDraftOffMainThread: tokenizeDraftMock,
}))

const mockReadMessages = readMessagesMock
const mockGetBlob = vi.spyOn(currentBlobStorage, 'get')

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'user',
    contentParts: [{ type: 'text', text: 'Hello world' }],
    ...overrides,
  }
}

function createMessageSource(overrides: Partial<SessionMessagesSource> = {}): SessionMessagesSource {
  return {
    header: { id: 'session-1', name: 'Test Session', type: 'chat' },
    revision: 1,
    messages: [createMessage()],
    ...overrides,
  }
}

function createMessageTextTask(overrides: Partial<ComputationTask> = {}): ComputationTask {
  return {
    id: 'msg:session-1:msg-1:default',
    type: 'message-text',
    sessionId: 'session-1',
    messageId: 'msg-1',
    tokenizerType: 'default',
    priority: 10,
    createdAt: Date.now(),
    ...overrides,
  }
}

function createAttachmentTask(overrides: Partial<ComputationTask> = {}): ComputationTask {
  return {
    id: 'att:session-1:msg-1:file-1:default:full',
    type: 'attachment',
    sessionId: 'session-1',
    messageId: 'msg-1',
    attachmentId: 'file-1',
    attachmentType: 'file',
    tokenizerType: 'default',
    contentMode: 'full',
    priority: 11,
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('executeTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    computationQueue._reset()
    _resetExactTokenizationFallbacks()
  })

  afterEach(() => {
    computationQueue._reset()
    _resetExactTokenizationFallbacks()
  })

  describe('session cancellation', () => {
    it('returns cancelled error when session is cancelled', async () => {
      let resolveTask: (() => void) | undefined
      const slowExecutor = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveTask = resolve
          })
      )
      computationQueue.setExecutor(slowExecutor)

      computationQueue.enqueue({
        type: 'message-text',
        sessionId: 'session-1',
        messageId: 'msg-1',
        tokenizerType: 'default',
        priority: 10,
      })

      await vi.waitFor(() => expect(computationQueue.getStatus().running).toBe(1))

      computationQueue.cancelBySession('session-1')

      const task = createMessageTextTask()
      const result = await executeTask(task)

      expect(result).toEqual({
        success: false,
        error: 'session_cancelled',
        silent: true,
      })

      if (resolveTask) resolveTask()
    })
  })

  describe('executeMessageTextTask', () => {
    it('keeps the issued SQL source paired with its exact snapshot without another read', async () => {
      const textSnapshot = 'Hello world'
      const textDigest = getTokenizationTextDigest(textSnapshot)
      const textSource: SessionTextTokenSource = {
        sessionId: 'session-1',
        messageId: 'msg-1',
        payloadId: 's:m:00000000-0000-4000-8000-000000000000',
        calculationVersion: SESSION_TEXT_TOKEN_VERSION,
        text: textSnapshot,
        textDigest,
      }
      const task = { ...createMessageTextTask(), textSnapshot, textDigest, textSource }
      const result = await executeTask(task)
      expect(result).toMatchObject({ success: true, result: { tokens: 2, textSource } })
      expect(result.result?.textSource).toBe(textSource)
      expect(mockReadMessages).not.toHaveBeenCalled()
      const edited = 'different text'
      expect(
        await executeTask({ ...task, textSnapshot: edited, textDigest: getTokenizationTextDigest(edited) })
      ).toEqual({
        success: false,
        error: 'stale_message_text',
        silent: true,
      })
      expect(mockReadMessages).not.toHaveBeenCalled()
    })

    it('issues a current source only after checking the selected message still matches the task', async () => {
      const textSnapshot = 'Hello world'
      const textDigest = getTokenizationTextDigest(textSnapshot)
      const source: SessionTextTokenSource = {
        sessionId: 'session-1',
        messageId: 'msg-1',
        payloadId: 's:m:00000000-0000-4000-8000-000000000000',
        calculationVersion: SESSION_TEXT_TOKEN_VERSION,
        text: textSnapshot,
        textDigest,
      }
      mockReadMessages.mockResolvedValue(
        createMessageSource({ textTokens: { sources: { 'msg-1': source }, results: [] } })
      )
      const task = { ...createMessageTextTask(), textSnapshot, textDigest, textSource: 'read-current' as const }
      expect(await executeTask(task)).toMatchObject({ success: true, result: { textSource: source } })
      expect(mockReadMessages).toHaveBeenCalledTimes(1)
      mockReadMessages.mockResolvedValue(
        createMessageSource({ messages: [createMessage({ contentParts: [{ type: 'text', text: 'edited' }] })] })
      )
      expect(await executeTask(task)).toEqual({ success: false, error: 'stale_message_text', silent: true })
    })

    it.each(['Hello world', ''])(
      'computes a supplied snapshot without reading stored messages: %j',
      async (textSnapshot) => {
        mockReadMessages.mockRejectedValue(new Error('Snapshot tasks must not read storage'))
        const task = { ...createMessageTextTask(), textSnapshot, textDigest: getTokenizationTextDigest(textSnapshot) }
        const result = await executeTask(task)
        expect(result).toMatchObject({
          success: true,
          result: { tokens: textSnapshot ? 2 : 0, approximate: false, textDigest: task.textDigest },
        })
        expect(result.result).not.toHaveProperty('textSnapshot')
        expect(mockReadMessages).not.toHaveBeenCalled()
      }
    )

    it.each([undefined, '', 'wrong-digest'])(
      'rejects snapshot tasks with missing or mismatched digest: %j',
      async (textDigest) => {
        mockReadMessages.mockRejectedValue(new Error('Invalid snapshots must not fall back to storage'))
        const result = await executeTask({ ...createMessageTextTask(), textSnapshot: 'snapshot', textDigest })
        expect(result).toEqual({ success: false, error: 'stale_message_text', silent: true })
        expect(mockReadMessages).not.toHaveBeenCalled()
        expect(tokenizeDraftMock).not.toHaveBeenCalled()
      }
    )

    it('computes tokens for message text successfully', async () => {
      const session = createMessageSource({
        messages: [createMessage({ id: 'msg-1', contentParts: [{ type: 'text', text: 'Hello world' }] })],
      })
      mockReadMessages.mockResolvedValue(session)

      const task = createMessageTextTask()
      const result = await executeTask(task)

      expect(result.success).toBe(true)
      expect(result.result).toBeDefined()
      expect(result.result?.type).toBe('message-text')
      expect(result.result?.sessionId).toBe('session-1')
      expect(result.result?.messageId).toBe('msg-1')
      expect(result.result?.tokens).toBeGreaterThan(0)
      expect(result.result?.calculatedAt).toBeDefined()
      expect(mockReadMessages).toHaveBeenCalledWith({ sessionId: 'session-1', messageIds: ['msg-1'] })
    })

    it('returns error when session not found', async () => {
      mockReadMessages.mockResolvedValue(null)

      const task = createMessageTextTask()
      const result = await executeTask(task)

      expect(result).toEqual({
        success: false,
        error: 'session_not_found',
        silent: true,
      })
    })

    it('returns error when message not found', async () => {
      const session = createMessageSource({ messages: [] })
      mockReadMessages.mockResolvedValue(session)

      const task = createMessageTextTask()
      const result = await executeTask(task)

      expect(result).toEqual({
        success: false,
        error: 'message_not_found',
        silent: true,
      })
    })

    it('accepts an archived message returned by the by-ID reader', async () => {
      const session = createMessageSource({
        messages: [createMessage({ id: 'msg-1', contentParts: [{ type: 'text', text: 'Thread message' }] })],
      })
      mockReadMessages.mockResolvedValue(session)

      const task = createMessageTextTask()
      const result = await executeTask(task)

      expect(result.success).toBe(true)
      expect(result.result?.tokens).toBeGreaterThan(0)
    })

    it('uses deepseek tokenizer when specified', async () => {
      const session = createMessageSource({
        messages: [createMessage({ id: 'msg-1', contentParts: [{ type: 'text', text: '你好世界' }] })],
      })
      mockReadMessages.mockResolvedValue(session)

      const task = createMessageTextTask({ tokenizerType: 'deepseek' })
      const result = await executeTask(task)

      expect(result.success).toBe(true)
      expect(result.result?.tokenizerType).toBe('deepseek')
    })
  })

  describe('long message text', () => {
    // Long enough for the draft worker; spaced words keep the sampling
    // fallback comparison cheap.
    const longText = 'queued draft word '.repeat(300)

    function sessionWithLongMessage(): SessionMessagesSource {
      return createMessageSource({
        messages: [createMessage({ id: 'msg-1', contentParts: [{ type: 'text', text: longText }] })],
      })
    }

    it.each([false, true])('uses the worker and bounded fallback for snapshots, worker failure: %s', async (failed) => {
      mockReadMessages.mockRejectedValue(new Error('Snapshot tasks must not read storage'))
      if (failed) tokenizeDraftMock.mockRejectedValue(new Error('worker unavailable'))
      else tokenizeDraftMock.mockResolvedValue(424242)
      const textDigest = getTokenizationTextDigest(longText)
      const result = await executeTask({
        ...createMessageTextTask(),
        textSnapshot: longText,
        textDigest,
        retryAttempt: 1,
      })
      expect(result).toMatchObject({
        success: true,
        result: {
          textDigest,
          approximate: failed,
          tokens: failed ? estimateDraftTokensImmediately(longText, 'default') : 424242,
        },
      })
      expect(tokenizeDraftMock).toHaveBeenCalledWith(longText, 'default', expect.any(AbortSignal), {
        lowPriority: true,
      })
      expect(mockReadMessages).not.toHaveBeenCalled()
      expect(getExactTokenizationFallbackCount('msg-1', 'default', textDigest)).toBe(0)
    })

    it('encodes in the draft worker at low priority instead of on this thread', async () => {
      mockReadMessages.mockResolvedValue(sessionWithLongMessage())
      tokenizeDraftMock.mockResolvedValue(424242)

      const result = await executeTask(createMessageTextTask())

      expect(result.success).toBe(true)
      expect(result.result?.tokens).toBe(424242)
      expect(result.result?.approximate).toBe(false)
      expect(result.result?.textDigest).toBe(getTokenizationTextDigest(longText))
      expect(tokenizeDraftMock).toHaveBeenCalledWith(longText, 'default', expect.any(AbortSignal), {
        lowPriority: true,
      })
    })

    it('persists the bounded sampling estimate marked approximate when the worker fails', async () => {
      mockReadMessages.mockResolvedValue(sessionWithLongMessage())
      tokenizeDraftMock.mockRejectedValue(new Error('worker unavailable'))

      const result = await executeTask(createMessageTextTask())

      expect(result.success).toBe(true)
      expect(result.result?.tokens).toBe(estimateDraftTokensImmediately(longText, 'default'))
      expect(result.result?.approximate).toBe(true)
      expect(result.result?.textDigest).toBe(getTokenizationTextDigest(longText))
      expect(result.result?.calculatedAt).toBeDefined()
    })

    it('leaves retry budget accounting to the persister', async () => {
      mockReadMessages.mockResolvedValue(sessionWithLongMessage())
      tokenizeDraftMock.mockRejectedValue(new Error('worker unavailable'))
      const textDigest = getTokenizationTextDigest(longText)

      await executeTask(createMessageTextTask())
      await executeTask(createMessageTextTask())
      expect(getExactTokenizationFallbackCount('msg-1', 'default', textDigest)).toBe(0)
    })

    it('drops a task whose analyzed source changed before execution', async () => {
      mockReadMessages.mockResolvedValue(sessionWithLongMessage())
      const result = await executeTask(
        createMessageTextTask({ textDigest: getTokenizationTextDigest('the previous text') })
      )

      expect(result).toEqual({ success: false, error: 'stale_message_text', silent: true })
      expect(tokenizeDraftMock).not.toHaveBeenCalled()
    })

    it('keeps short text on the synchronous encoder', async () => {
      mockReadMessages.mockResolvedValue(createMessageSource())

      const result = await executeTask(createMessageTextTask())

      expect(result.success).toBe(true)
      expect(result.result?.approximate).toBe(false)
      expect(tokenizeDraftMock).not.toHaveBeenCalled()
    })
  })

  describe('executeAttachmentTask', () => {
    it('computes tokens for file attachment successfully', async () => {
      const session = createMessageSource({
        messages: [
          createMessage({
            id: 'msg-1',
            files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'storage-key-1' }],
          }),
        ],
      })
      mockReadMessages.mockResolvedValue(session)
      mockGetBlob.mockResolvedValue('File content here\nLine 2\nLine 3')

      const task = createAttachmentTask()
      const result = await executeTask(task)

      expect(result.success).toBe(true)
      expect(result.result?.type).toBe('attachment')
      expect(result.result?.attachmentId).toBe('file-1')
      expect(result.result?.attachmentType).toBe('file')
      expect(result.result?.tokens).toBeGreaterThan(0)
      expect(result.result?.lineCount).toBe(3)
      expect(result.result?.byteLength).toBeGreaterThan(0)
    })

    it('computes tokens for link attachment successfully', async () => {
      const session = createMessageSource({
        messages: [
          createMessage({
            id: 'msg-1',
            links: [{ id: 'link-1', url: 'https://example.com', title: 'Example', storageKey: 'storage-key-1' }],
          }),
        ],
      })
      mockReadMessages.mockResolvedValue(session)
      mockGetBlob.mockResolvedValue('Link content here')

      const task = createAttachmentTask({
        attachmentId: 'link-1',
        attachmentType: 'link',
      })
      const result = await executeTask(task)

      expect(result.success).toBe(true)
      expect(result.result?.attachmentType).toBe('link')
    })

    it('returns error when attachment info is missing', async () => {
      const task = createAttachmentTask({ attachmentId: undefined })
      const result = await executeTask(task)

      expect(result).toEqual({
        success: false,
        error: 'missing_attachment_info',
      })
    })

    it('returns error when attachment not found', async () => {
      const session = createMessageSource({
        messages: [createMessage({ id: 'msg-1', files: [] })],
      })
      mockReadMessages.mockResolvedValue(session)

      const task = createAttachmentTask()
      const result = await executeTask(task)

      expect(result).toEqual({
        success: false,
        error: 'attachment_not_found',
        silent: true,
      })
    })

    it('returns error when no storage key', async () => {
      const session = createMessageSource({
        messages: [
          createMessage({
            id: 'msg-1',
            files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain' }],
          }),
        ],
      })
      mockReadMessages.mockResolvedValue(session)

      const task = createAttachmentTask()
      const result = await executeTask(task)

      expect(result).toEqual({
        success: false,
        error: 'no_storage_key',
      })
    })

    it('returns a retryable failure with no cache result when storage read fails', async () => {
      const session = createMessageSource({
        messages: [
          createMessage({
            id: 'msg-1',
            files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'storage-key-1' }],
          }),
        ],
      })
      mockReadMessages.mockResolvedValue(session)
      mockGetBlob.mockRejectedValue(new Error('Storage error'))

      const task = createAttachmentTask()
      const result = await executeTask(task)

      expect(result).toEqual({ success: false, error: 'attachment_read_failed', retryable: true })
    })

    it('returns zero tokens when content is empty', async () => {
      const session = createMessageSource({
        messages: [
          createMessage({
            id: 'msg-1',
            files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'storage-key-1' }],
          }),
        ],
      })
      mockReadMessages.mockResolvedValue(session)
      mockGetBlob.mockResolvedValue('')

      const task = createAttachmentTask()
      const result = await executeTask(task)

      expect(result.success).toBe(true)
      expect(result.result?.tokens).toBe(0)
      expect(result.result?.sourceStorageKey).toBe('storage-key-1')
      expect(result.result?.sourceName).toBe('test.txt')
      mockGetBlob.mockResolvedValue(null)
      expect(await executeTask(task)).toEqual({ success: false, error: 'attachment_content_missing', retryable: true })
    })

    it('uses preview mode correctly', async () => {
      const lines = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}`).join('\n')
      const session = createMessageSource({
        messages: [
          createMessage({
            id: 'msg-1',
            files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'storage-key-1' }],
          }),
        ],
      })
      mockReadMessages.mockResolvedValue(session)
      mockGetBlob.mockResolvedValue(lines)

      const fullTask = createAttachmentTask({ contentMode: 'full' })
      const fullResult = await executeTask(fullTask)

      const previewTask = createAttachmentTask({ contentMode: 'preview' })
      const previewResult = await executeTask(previewTask)

      expect(fullResult.success).toBe(true)
      expect(previewResult.success).toBe(true)
      expect(previewResult.result?.contentMode).toBe('preview')
      expect(previewResult.result?.lineCount).toBe(200)
      expect(previewResult.result?.tokens).toBeLessThan(fullResult.result?.tokens ?? 0)
    })

    it('includes wrapper tokens in calculation', async () => {
      const session = createMessageSource({
        messages: [
          createMessage({
            id: 'msg-1',
            files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'storage-key-1' }],
          }),
        ],
      })
      mockReadMessages.mockResolvedValue(session)
      mockGetBlob.mockResolvedValue('x')

      const task = createAttachmentTask()
      const result = await executeTask(task)

      expect(result.success).toBe(true)
      expect(result.result?.tokens).toBeGreaterThan(1)
    })
  })
})

describe('initializeExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    computationQueue._reset()
  })

  afterEach(() => {
    computationQueue._reset()
  })

  it('connects executor to computation queue', async () => {
    const session = createMessageSource()
    mockReadMessages.mockResolvedValue(session)

    initializeExecutor()

    computationQueue.enqueue({
      type: 'message-text',
      sessionId: 'session-1',
      messageId: 'msg-1',
      tokenizerType: 'default',
      priority: 10,
    })

    await vi.waitFor(() => expect(computationQueue.getStatus().running).toBe(0))
    expect(computationQueue._getState().completed.size).toBe(1)
  })

  it('passes results to result persister', async () => {
    const session = createMessageSource()
    mockReadMessages.mockResolvedValue(session)

    const mockPersister = { addResult: vi.fn() }
    setResultPersister(mockPersister)
    initializeExecutor()

    computationQueue.enqueue({
      type: 'message-text',
      sessionId: 'session-1',
      messageId: 'msg-1',
      tokenizerType: 'default',
      priority: 10,
    })

    await vi.waitFor(() => expect(mockPersister.addResult).toHaveBeenCalled())
    expect(mockPersister.addResult).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message-text',
        sessionId: 'session-1',
        messageId: 'msg-1',
      })
    )
  })

  it('does not persist zero attachment data after null or failed blob reads exhaust retry attempts', async () => {
    vi.useFakeTimers()
    try {
      mockReadMessages.mockResolvedValue(
        createMessageSource({
          messages: [
            createMessage({ files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'blob' }] }),
          ],
        })
      )
      mockGetBlob.mockResolvedValueOnce(null).mockRejectedValue(new Error('Storage unavailable'))
      const persister = { addResult: vi.fn() }
      setResultPersister(persister)
      initializeExecutor()
      computationQueue.enqueue(createAttachmentTask())
      await vi.runAllTimersAsync()
      expect(mockGetBlob).toHaveBeenCalledTimes(3)
      expect(persister.addResult).not.toHaveBeenCalled()
      expect(computationQueue.getStatus().running).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('setResultPersister', () => {
  it('allows setting result persister', () => {
    const mockPersister = { addResult: vi.fn() }
    expect(() => setResultPersister(mockPersister)).not.toThrow()
  })
})
