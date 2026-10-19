import type { SessionService } from '@chatbox/core/application/session'
import type { SessionQueryBridge } from '@chatbox/react/query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { generationRuntimeMock, updateMessageCacheMock, updateMessageMock } = vi.hoisted(() => ({
  generationRuntimeMock: { clear: vi.fn(), get: vi.fn() },
  updateMessageCacheMock: vi.fn<SessionQueryBridge['updateMessageCache']>().mockResolvedValue(undefined),
  updateMessageMock: vi.fn<SessionService['updateMessage']>().mockResolvedValue(undefined),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    generationRuntime: generationRuntimeMock,
    sessions: { updateMessage: updateMessageMock },
    sessionQueryBridge: { updateMessageCache: updateMessageCacheMock },
  },
}))

vi.mock('../../settingsStore', () => ({
  settingsStore: { getState: vi.fn().mockReturnValue({ getSettings: vi.fn().mockReturnValue({}) }) },
}))

vi.mock('../../uiStore', () => ({
  uiStore: { getState: vi.fn().mockReturnValue({ sessionWebBrowsingMap: {} }) },
}))

vi.mock('@/platform', () => ({ default: { type: 'test' } }))

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

vi.mock('@/adapters', () => ({ createModel: vi.fn() }))

vi.mock('@/packages/model-setting-utils', () => ({ getModelDisplayName: vi.fn() }))

vi.mock('@/packages/context-management', () => ({ runCompactionWithUIState: vi.fn() }))

vi.mock('../../settingActions', () => ({
  isPro: vi.fn().mockReturnValue(false),
  getRemoteConfig: vi.fn().mockResolvedValue({}),
}))

vi.mock('@shared/utils/message', () => ({
  countMessageWords: vi.fn().mockReturnValue(42),
}))

vi.mock('@/packages/token', () => ({
  estimateTokensFromMessages: vi.fn().mockReturnValue(100),
}))

import type { Message } from '@shared/types'
import { persistStreamingMessage, updateStreamingCache } from '../messages'

function createTestMessage(overrides?: Partial<Message>): Message {
  return {
    id: 'test-msg-1',
    role: 'assistant',
    contentParts: [{ type: 'text', text: 'hello' }],
    timestamp: 0,
    ...overrides,
  } as Message
}

describe('updateStreamingCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the message snapshot and publication guard to the query bridge', () => {
    const msg = createTestMessage()
    updateStreamingCache('session-1', msg)
    expect(updateMessageCacheMock).toHaveBeenCalledWith(
      'session-1',
      'test-msg-1',
      expect.objectContaining({ id: 'test-msg-1', contentParts: [{ type: 'text', text: 'hello' }] }),
      { shouldApply: expect.any(Function) }
    )
  })

  it('keeps the queued snapshot unchanged when the live message continues streaming', () => {
    const msg = createTestMessage({ generating: true })
    updateStreamingCache('session-snapshot', msg)
    const snapshot = updateMessageCacheMock.mock.calls[0]?.[2]
    expect(snapshot).not.toBe(msg)

    const part = msg.contentParts[0]
    if (part.type !== 'text') throw new Error('Missing text fixture')
    part.text = 'hello world'
    msg.contentParts.push({ type: 'text', text: '!' })
    msg.generating = false

    expect(snapshot).toMatchObject({ generating: true, contentParts: [{ type: 'text', text: 'hello' }] })
  })

  it('invalidates pending publication guards when newer chunks or terminal state arrive', async () => {
    let releaseRead!: () => void
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    updateMessageCacheMock.mockImplementationOnce(() => readGate)
    let terminal: Promise<void> | undefined
    try {
      updateStreamingCache('session-guards', createTestMessage({ generating: true }))
      const firstGuard = updateMessageCacheMock.mock.calls[0]?.[3]?.shouldApply
      expect(firstGuard?.()).toBe(true)

      updateStreamingCache(
        'session-guards',
        createTestMessage({ generating: true, contentParts: [{ type: 'text', text: 'hello world' }] })
      )
      const secondGuard = updateMessageCacheMock.mock.calls[1]?.[3]?.shouldApply
      expect(firstGuard?.()).toBe(false)
      expect(secondGuard?.()).toBe(true)

      terminal = persistStreamingMessage('session-guards', createTestMessage({ generating: false }))
      expect(firstGuard?.()).toBe(false)
      expect(secondGuard?.()).toBe(false)
    } finally {
      releaseRead()
      await Promise.all([readGate, terminal])
    }
  })

  it('sets message.timestamp', () => {
    const msg = createTestMessage({ timestamp: 0 })
    const before = Date.now()
    updateStreamingCache('session-1', msg)
    expect(msg.timestamp).toBeGreaterThanOrEqual(before)
  })

  it('does not throw when the session service rejects', async () => {
    updateMessageCacheMock.mockRejectedValueOnce(new Error('fail'))
    expect(() => updateStreamingCache('session-1', createTestMessage())).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
})

describe('persistStreamingMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls updateMessageMock', async () => {
    const msg = createTestMessage()
    await persistStreamingMessage('session-1', msg)
    expect(updateMessageMock).toHaveBeenCalledWith(
      'session-1',
      'test-msg-1',
      expect.objectContaining({ id: 'test-msg-1' })
    )
  })

  it('preserves a completed reply when a stale Stop reaches persistence after terminal cleanup', async () => {
    const completed = createTestMessage({
      generating: false,
      contentParts: [{ type: 'text', text: 'complete reply with the final chunk' }],
      finishReason: 'stop',
      tokenCount: 80,
    })
    let stored = completed
    const applyUpdate: SessionService['updateMessage'] = async (_sessionId, _messageId, update) => {
      stored = { ...stored, ...(typeof update === 'function' ? update(stored) : update) }
    }
    updateMessageMock.mockImplementationOnce(applyUpdate).mockImplementationOnce(applyUpdate)
    await persistStreamingMessage('session-completed-before-stop', completed)
    const terminal = stored

    await persistStreamingMessage(
      'session-completed-before-stop',
      createTestMessage({ generating: false, finishReason: 'canceled', tokenCount: 2 }),
      { onlyIfGenerating: true }
    )

    expect(updateMessageMock).toHaveBeenCalledTimes(2)
    expect(stored).toEqual(terminal)
    expect(stored).toMatchObject({
      contentParts: [{ type: 'text', text: 'complete reply with the final chunk' }],
      finishReason: 'stop',
      tokenCount: 80,
    })
  })

  it('persists the visible Stop snapshot while the stored reply is still generating', async () => {
    let stored = createTestMessage({ generating: true })
    updateMessageMock.mockImplementationOnce(async (_sessionId, _messageId, update) => {
      stored = { ...stored, ...(typeof update === 'function' ? update(stored) : update) }
    })
    const stopped = createTestMessage({
      generating: false,
      contentParts: [{ type: 'text', text: 'latest visible partial reply' }],
      finishReason: 'canceled',
    })

    await persistStreamingMessage('session-stop-live-snapshot', stopped, { onlyIfGenerating: true })

    expect(stored).toEqual({ ...stopped, status: [] })
  })

  it('sets message.timestamp', async () => {
    const msg = createTestMessage({ timestamp: 0 })
    const before = Date.now()
    await persistStreamingMessage('session-1', msg)
    expect(msg.timestamp).toBeGreaterThanOrEqual(before)
  })

  it('refreshes counting when option is set', async () => {
    const msg = createTestMessage()
    await persistStreamingMessage('session-1', msg, { refreshCounting: true })
    expect(msg.wordCount).toBe(42)
    expect(msg.tokenCount).toBe(100)
    expect(msg.tokenCountMap).toBeUndefined()
  })

  it('does not refresh counting by default', async () => {
    const msg = createTestMessage({ wordCount: 10 })
    await persistStreamingMessage('session-1', msg)
    expect(msg.wordCount).toBe(10)
  })

  it('supersedes a pending generating checkpoint with the terminal message', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    updateMessageMock.mockImplementationOnce(() => firstGate)
    const first = persistStreamingMessage(
      'session-ordering',
      createTestMessage({ id: 'message-ordering', generating: true }),
      { checkpoint: true }
    )
    const pending = persistStreamingMessage(
      'session-ordering',
      createTestMessage({ id: 'message-ordering', generating: true, contentParts: [{ type: 'text', text: 'later' }] }),
      { checkpoint: true }
    )
    const terminal = persistStreamingMessage(
      'session-ordering',
      createTestMessage({ id: 'message-ordering', generating: false, contentParts: [{ type: 'text', text: 'done' }] })
    )

    expect(updateMessageMock).toHaveBeenCalledOnce()
    releaseFirst()
    await Promise.all([first, pending, terminal])

    expect(updateMessageMock).toHaveBeenCalledTimes(2)
    expect(updateMessageMock.mock.calls[1]?.[2]).toMatchObject({ generating: false })
  })
})
