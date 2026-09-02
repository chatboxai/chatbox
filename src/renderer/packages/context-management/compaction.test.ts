import type { Message, Session } from '@shared/types'
import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compactionUIStateMapAtom, getCompactionUIState } from '@/stores/atoms/compactionAtoms'

const { generateSummaryWithStreamMock, getSessionMock, updateSessionWithMessagesMock } = vi.hoisted(() => ({
  generateSummaryWithStreamMock: vi.fn(),
  getSessionMock: vi.fn(),
  updateSessionWithMessagesMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { updateSessionWithMessages: updateSessionWithMessagesMock },
    sessionQueryBridge: { getSession: getSessionMock },
  },
}))
vi.mock('@/stores/session/session-settings', () => ({
  getSessionSettings: vi.fn(async () => ({})),
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
  beforeEach(() => {
    vi.clearAllMocks()
    getDefaultStore().set(compactionUIStateMapAtom, {})
    getSessionMock.mockResolvedValue(testSession())
    updateSessionWithMessagesMock.mockImplementation((_id: string, updater: (s: Session) => Session) => {
      updater(testSession())
      return Promise.resolve()
    })
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
