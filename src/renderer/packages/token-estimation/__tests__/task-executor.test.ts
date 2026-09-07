import type { Message, Session } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computationQueue } from '../computation-queue'
import { estimateDraftTokensImmediately, getTokenizationTextDigest } from '../draft-tokenization'
import { _resetExactTokenizationFallbacks, getExactTokenizationFallbackCount } from '../exact-retry'
import { executeTask, initializeExecutor, setResultPersister } from '../task-executor'
import type { ComputationTask } from '../types'

const { getSessionMock, tokenizeDraftMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  tokenizeDraftMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessionQueryBridge: { getSession: getSessionMock } },
}))

vi.mock('@/storage', () => ({
  default: {
    getBlob: vi.fn(),
  },
}))

vi.mock('../draft-tokenizer-worker-client', () => ({
  tokenizeDraftOffMainThread: tokenizeDraftMock,
}))

import storage from '@/storage'

const mockGetSession = getSessionMock
const mockGetBlob = vi.mocked(storage.getBlob)

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'user',
    contentParts: [{ type: 'text', text: 'Hello world' }],
    ...overrides,
  }
}

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Test Session',
    type: 'chat',
    messages: [createMessage()],
    ...overrides,
  } as Session
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
    it('computes tokens for message text successfully', async () => {
      const session = createSession({
        messages: [createMessage({ id: 'msg-1', contentParts: [{ type: 'text', text: 'Hello world' }] })],
      })
      mockGetSession.mockResolvedValue(session)

      const task = createMessageTextTask()
      const result = await executeTask(task)

      expect(result.success).toBe(true)
      expect(result.result).toBeDefined()
      expect(result.result?.type).toBe('message-text')
      expect(result.result?.sessionId).toBe('session-1')
      expect(result.result?.messageId).toBe('msg-1')
      expect(result.result?.tokens).toBeGreaterThan(0)
      expect(result.result?.calculatedAt).toBeDefined()
    })

    it('returns error when session not found', async () => {
      mockGetSession.mockResolvedValue(null)

      const task = createMessageTextTask()
      const result = await executeTask(task)

      expect(result).toEqual({
        success: false,
        error: 'session_not_found',
        silent: true,
      })
    })

    it('returns error when message not found', async () => {
      const session = createSession({ messages: [] })
      mockGetSession.mockResolvedValue(session)

      const task = createMessageTextTask()
      const result = await executeTask(task)

      expect(result).toEqual({
        success: false,
        error: 'message_not_found',
        silent: true,
      })
    })

    it('finds message in threads', async () => {
      const session = createSession({
        messages: [],
        threads: [
          {
            id: 'thread-1',
            name: 'Thread 1',
            messages: [createMessage({ id: 'msg-1', contentParts: [{ type: 'text', text: 'Thread message' }] })],
            createdAt: Date.now(),
          },
        ],
      })
      mockGetSession.mockResolvedValue(session)

      const task = createMessageTextTask()
      const result = await executeTask(task)

      expect(result.success).toBe(true)
      expect(result.result?.tokens).toBeGreaterThan(0)
    })

    it('uses deepseek tokenizer when specified', async () => {
      const session = createSession({
        messages: [createMessage({ id: 'msg-1', contentParts: [{ type: 'text', text: '你好世界' }] })],
      })
      mockGetSession.mockResolvedValue(session)

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

    function sessionWithLongMessage(): Session {
      return createSession({
        messages: [createMessage({ id: 'msg-1', contentParts: [{ type: 'text', text: longText }] })],
      })
    }

    it('encodes in the draft worker at low priority instead of on this thread', async () => {
      mockGetSession.mockResolvedValue(sessionWithLongMessage())
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
      mockGetSession.mockResolvedValue(sessionWithLongMessage())
      tokenizeDraftMock.mockRejectedValue(new Error('worker unavailable'))

      const result = await executeTask(createMessageTextTask())

      expect(result.success).toBe(true)
      expect(result.result?.tokens).toBe(estimateDraftTokensImmediately(longText, 'default'))
      expect(result.result?.approximate).toBe(true)
      expect(result.result?.textDigest).toBe(getTokenizationTextDigest(longText))
      expect(result.result?.calculatedAt).toBeDefined()
    })

    it('leaves retry budget accounting to the persister', async () => {
      mockGetSession.mockResolvedValue(sessionWithLongMessage())
      tokenizeDraftMock.mockRejectedValue(new Error('worker unavailable'))
      const textDigest = getTokenizationTextDigest(longText)

      await executeTask(createMessageTextTask())
      await executeTask(createMessageTextTask())
      expect(getExactTokenizationFallbackCount('msg-1', 'default', textDigest)).toBe(0)
    })

    it('drops a task whose analyzed source changed before execution', async () => {
      mockGetSession.mockResolvedValue(sessionWithLongMessage())
      const result = await executeTask(
        createMessageTextTask({ textDigest: getTokenizationTextDigest('the previous text') })
      )

      expect(result).toEqual({ success: false, error: 'stale_message_text', silent: true })
      expect(tokenizeDraftMock).not.toHaveBeenCalled()
    })

    it('keeps short text on the synchronous encoder', async () => {
      mockGetSession.mockResolvedValue(createSession())

      const result = await executeTask(createMessageTextTask())

      expect(result.success).toBe(true)
      expect(result.result?.approximate).toBe(false)
      expect(tokenizeDraftMock).not.toHaveBeenCalled()
    })
  })

  describe('executeAttachmentTask', () => {
    it('computes tokens for file attachment successfully', async () => {
      const session = createSession({
        messages: [
          createMessage({
            id: 'msg-1',
            files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'storage-key-1' }],
          }),
        ],
      })
      mockGetSession.mockResolvedValue(session)
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
      const session = createSession({
        messages: [
          createMessage({
            id: 'msg-1',
            links: [{ id: 'link-1', url: 'https://example.com', title: 'Example', storageKey: 'storage-key-1' }],
          }),
        ],
      })
      mockGetSession.mockResolvedValue(session)
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
      const session = createSession({
        messages: [createMessage({ id: 'msg-1', files: [] })],
      })
      mockGetSession.mockResolvedValue(session)

      const task = createAttachmentTask()
      const result = await executeTask(task)

      expect(result).toEqual({
        success: false,
        error: 'attachment_not_found',
        silent: true,
      })
    })

    it('returns error when no storage key', async () => {
      const session = createSession({
        messages: [
          createMessage({
            id: 'msg-1',
            files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain' }],
          }),
        ],
      })
      mockGetSession.mockResolvedValue(session)

      const task = createAttachmentTask()
      const result = await executeTask(task)

      expect(result).toEqual({
        success: false,
        error: 'no_storage_key',
      })
    })

    it('returns zero tokens when storage read fails', async () => {
      const session = createSession({
        messages: [
          createMessage({
            id: 'msg-1',
            files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'storage-key-1' }],
          }),
        ],
      })
      mockGetSession.mockResolvedValue(session)
      mockGetBlob.mockRejectedValue(new Error('Storage error'))

      const task = createAttachmentTask()
      const result = await executeTask(task)

      expect(result.success).toBe(true)
      expect(result.result?.tokens).toBe(0)
      expect(result.result?.lineCount).toBe(0)
      expect(result.result?.byteLength).toBe(0)
    })

    it('returns zero tokens when content is empty', async () => {
      const session = createSession({
        messages: [
          createMessage({
            id: 'msg-1',
            files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'storage-key-1' }],
          }),
        ],
      })
      mockGetSession.mockResolvedValue(session)
      mockGetBlob.mockResolvedValue(null)

      const task = createAttachmentTask()
      const result = await executeTask(task)

      expect(result.success).toBe(true)
      expect(result.result?.tokens).toBe(0)
    })

    it('uses preview mode correctly', async () => {
      const lines = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}`).join('\n')
      const session = createSession({
        messages: [
          createMessage({
            id: 'msg-1',
            files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'storage-key-1' }],
          }),
        ],
      })
      mockGetSession.mockResolvedValue(session)
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
      const session = createSession({
        messages: [
          createMessage({
            id: 'msg-1',
            files: [{ id: 'file-1', name: 'test.txt', fileType: 'text/plain', storageKey: 'storage-key-1' }],
          }),
        ],
      })
      mockGetSession.mockResolvedValue(session)
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
    const session = createSession()
    mockGetSession.mockResolvedValue(session)

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
    const session = createSession()
    mockGetSession.mockResolvedValue(session)

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
})

describe('setResultPersister', () => {
  it('allows setting result persister', () => {
    const mockPersister = { addResult: vi.fn() }
    expect(() => setResultPersister(mockPersister)).not.toThrow()
  })
})
