import { buildContext } from '@shared/context'
import { estimateTokensForTokenizerType } from '@shared/token-estimation/tokenizer'
import type { Message, Session } from '@shared/types'
import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compactionUIStateMapAtom, getCompactionUIState } from '@/stores/atoms/compactionAtoms'

const { generateSummaryWithStreamMock, getSessionMock, updateSessionWithMessagesMock, getSessionSettingsMock } =
  vi.hoisted(() => ({
    generateSummaryWithStreamMock: vi.fn(),
    getSessionMock: vi.fn(),
    getSessionSettingsMock: vi.fn(),
    updateSessionWithMessagesMock: vi.fn(),
  }))

vi.mock('@/adapters', () => ({ createModel: vi.fn() }))
vi.mock('@/platform', () => ({ default: { isDesktopLike: false } }))
vi.mock('@/sandbox', () => ({ createSandboxProvider: vi.fn() }))
vi.mock('@/stores/session/agent-mode', () => ({ getSessionAgentModeEntry: () => ({ value: 'off' }) }))
vi.mock('@/stores/settingActions', () => ({ isPro: () => true }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { updateSessionWithMessages: updateSessionWithMessagesMock },
    sessionQueryBridge: { getSession: getSessionMock },
  },
}))
vi.mock('@/stores/session/session-settings', () => ({
  getSessionSettings: getSessionSettingsMock,
}))
vi.mock('@/settings-runtime', () => ({
  settingsService: { getSettings: () => ({ defaultChatModel: { model: 'test-model' } }) },
}))
vi.mock('@/stores/queryClient', () => ({ default: { getQueryData: vi.fn(), setQueryData: vi.fn() } }))
vi.mock('@/packages/token-estimation', () => ({ getTokenizerType: () => 'estimate' }))
vi.mock('../token', () => ({ sumCachedTokensFromMessages: () => 0 }))
vi.mock('./context-tokens', () => ({
  getContextMessagesForTokenEstimation: (session: Session) => session.messages,
  getContextTokensCacheKey: () => ['context-tokens', 'test'],
  getLatestCompactionBoundaryId: () => null,
}))
vi.mock('./summary-generator', () => ({ generateSummaryWithStream: generateSummaryWithStreamMock }))

import { runCompactionWithUIState } from './compaction'

function message(id: string, overrides: Partial<Message> = {}): Message {
  return { id, role: 'assistant', contentParts: [], ...overrides }
}

function testSession(): Session {
  return {
    id: 'session-1',
    name: 'Test',
    messages: [message('u1', { role: 'user' }), message('a1')],
  }
}

describe('runCompactionWithUIState', () => {
  it('forwards a one-time prompt to the summary generator', async () => {
    generateSummaryWithStreamMock.mockResolvedValue({ success: true, summary: 'Summary' })
    await runCompactionWithUIState('session-1', { force: true, prompt: 'Keep exact paths.' })
    expect(generateSummaryWithStreamMock).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Keep exact paths.' }))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    getDefaultStore().set(compactionUIStateMapAtom, {})
    getSessionMock.mockResolvedValue(testSession())
    getSessionSettingsMock.mockResolvedValue({})
    updateSessionWithMessagesMock.mockImplementation((_id: string, updater: (s: Session) => Session) => {
      updater(testSession())
      return Promise.resolve()
    })
  })

  it('keeps long-history compaction within the normal send window', async () => {
    const oldText = ' historical'.repeat(100_001)
    const textTokenCounts = new Map<string, number>([[oldText, estimateTokensForTokenizerType(oldText, 'default')]])
    const countInputTokens = (messages: Message[]) =>
      messages.reduce(
        (total, message) =>
          total +
          message.contentParts.reduce((subtotal, part) => {
            if (part.type !== 'text') return subtotal
            const count = textTokenCounts.get(part.text) ?? estimateTokensForTokenizerType(part.text, 'default')
            textTokenCounts.set(part.text, count)
            return subtotal + count
          }, 0),
        0
      )
    const session: Session = {
      ...testSession(),
      settings: { provider: 'openai', modelId: 'test-model', maxContextMessageCount: 4 },
      messages: [
        ...Array.from({ length: 12 }, (_, index) =>
          message(`old-${index}`, {
            role: index % 2 === 0 ? 'user' : 'assistant',
            contentParts: [{ type: 'text', text: oldText }],
          })
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          message(`recent-${index}`, {
            role: index % 2 === 0 ? 'user' : 'assistant',
            contentParts: [{ type: 'text', text: `recent ${index}` }],
          })
        ),
      ],
    }
    const pending = message('pending', { role: 'user', contentParts: [{ type: 'text', text: 'next question' }] })
    const sendContext = await buildContext([...session.messages, pending], {
      attachmentResolver: { read: async () => null },
      maxContextMessageCount: 4,
      toolCleanupMode: 'none',
    })
    expect(countInputTokens(session.messages)).toBeGreaterThan(1_000_000)
    expect(countInputTokens(sendContext)).toBeLessThan(100)
    getSessionMock.mockResolvedValue(session)
    getSessionSettingsMock.mockResolvedValue(session.settings)
    updateSessionWithMessagesMock.mockImplementation((_id: string, updater: (current: Session) => Session) =>
      Promise.resolve(updater(session))
    )
    let summarizedMessages: Message[] = []
    generateSummaryWithStreamMock.mockImplementation(({ messages }: { messages: Message[] }) => {
      summarizedMessages = messages
      if (countInputTokens(messages) > 1_000_000) {
        return {
          success: false,
          error: new Error('InternalError.Algo.InvalidParameter: Range of input length should be [1, 1000000]'),
        }
      }
      return Promise.resolve({ success: true, summary: 'Summary' })
    })
    const result = await runCompactionWithUIState(session.id, { force: true, pendingMessage: pending })
    expect(result, `Summary input tokens (cl100k_base): ${countInputTokens(summarizedMessages)}`).toMatchObject({
      success: true,
      compacted: true,
    })
    expect(countInputTokens(summarizedMessages)).toBe(12)
    expect(summarizedMessages).toEqual(sendContext.filter((message) => message.id !== pending.id))
    expect(getCompactionUIState(session.id).status).toBe('completed')
  })

  it('keeps the running UI state when a duplicate request arrives mid-stream', async () => {
    let resolveSummary: (value: { success: boolean; summary: string }) => void = () => {}
    generateSummaryWithStreamMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSummary = resolve
      })
    )

    const first = runCompactionWithUIState('session-1', { force: true })
    await vi.waitFor(() => {
      expect(getCompactionUIState('session-1').status).toBe('running')
      expect(generateSummaryWithStreamMock).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }))
    })

    // e.g. the manual Compress modal confirmed while auto-compaction streams
    const duplicate = await runCompactionWithUIState('session-1', { force: true })

    expect(duplicate).toMatchObject({ success: true, compacted: false, alreadyRunning: true })
    // The duplicate must not reset the owner's UI state: fork switching stays
    // locked while the summary is still streaming.
    expect(getCompactionUIState('session-1').status).toBe('running')

    resolveSummary({ success: true, summary: 'summary text' })
    const result = await first

    expect(result).toMatchObject({ success: true, compacted: true })
    expect(getCompactionUIState('session-1')).toMatchObject({
      status: 'completed',
      summaryMessageId: expect.any(String),
    })
  })
})
