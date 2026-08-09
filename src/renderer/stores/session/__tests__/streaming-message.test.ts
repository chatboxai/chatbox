import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../chatStore', () => ({
  updateMessageCache: vi.fn().mockResolvedValue(undefined),
  updateMessage: vi.fn().mockResolvedValue(undefined),
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
import * as chatStore from '../../chatStore'
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

  it('calls chatStore.updateMessageCache with correct args', () => {
    const msg = createTestMessage()
    updateStreamingCache('session-1', msg)
    expect(chatStore.updateMessageCache).toHaveBeenCalledWith(
      'session-1',
      'test-msg-1',
      expect.objectContaining({ id: 'test-msg-1' })
    )
  })

  it('sets message.timestamp', () => {
    const msg = createTestMessage({ timestamp: 0 })
    const before = Date.now()
    updateStreamingCache('session-1', msg)
    expect(msg.timestamp).toBeGreaterThanOrEqual(before)
  })

  it('does not throw when chatStore rejects', async () => {
    vi.mocked(chatStore.updateMessageCache).mockRejectedValueOnce(new Error('fail'))
    expect(() => updateStreamingCache('session-1', createTestMessage())).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
})

describe('persistStreamingMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls chatStore.updateMessage', async () => {
    const msg = createTestMessage()
    await persistStreamingMessage('session-1', msg)
    expect(chatStore.updateMessage).toHaveBeenCalledWith(
      'session-1',
      'test-msg-1',
      expect.objectContaining({ id: 'test-msg-1' })
    )
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
})
