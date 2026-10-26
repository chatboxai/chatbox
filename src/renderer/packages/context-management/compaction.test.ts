vi.mock('../token-estimation/policy', () => ({
  resolveTokenEstimationPolicy: (...args: unknown[]) => resolveTokenEstimationPolicyMock(...args),
}))
vi.mock('@/stores/session/agent-mode', () => ({ getSessionAgentModeEntry: () => ({ value: 'off' }) }))

import {
  hasPendingSessionGeneration,
  waitForSessionGenerations,
  withSessionGenerationLock,
} from '@chatbox/core/generation'
import { SessionEventBus, SessionService, SessionWriteCoordinator } from '@chatbox/core/application/session'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import { buildContext } from '@shared/context'
import { estimateTokensForTokenizerType } from '@shared/token-estimation/tokenizer'
import type { Message, Session } from '@shared/types'
import { getDefaultStore } from 'jotai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compactionUIStateMapAtom, getCompactionUIState } from '@/stores/atoms/compactionAtoms'

const {
  resolveTokenEstimationPolicyMock,
  generateSummaryWithStreamMock,
  getSessionHeaderMock,
  getSessionContextSourceMock,
  estimateMock,
  readConversationAnchorIdMock,
  commitSessionCompactionMock,
  getSessionSettingsMock,
  getSessionLockStateMock,
  enqueueCompactionRequestMock,
  hasQueuedWorkMock,
} = vi.hoisted(() => ({
  resolveTokenEstimationPolicyMock: vi.fn(),
  generateSummaryWithStreamMock: vi.fn(),
  getSessionHeaderMock: vi.fn(),
  getSessionContextSourceMock: vi.fn(),
  estimateMock: vi.fn(),
  readConversationAnchorIdMock: vi.fn(),
  getSessionSettingsMock: vi.fn(),
  commitSessionCompactionMock: vi.fn(),
  getSessionLockStateMock: vi.fn(),
  enqueueCompactionRequestMock: vi.fn(),
  hasQueuedWorkMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', async () => {
  const { BackupOperationCoordinator } = await import('@chatbox/core/backup')
  return {
    rendererApplication: {
      backupOperations: new BackupOperationCoordinator(),
      sessions: {
        getSessionHeader: getSessionHeaderMock,
        getSessionContextSource: getSessionContextSourceMock,
        commitSessionCompaction: commitSessionCompactionMock,
      },
    },
  }
})
vi.mock('@/stores/session/session-settings', () => ({
  getSessionSettings: getSessionSettingsMock,
}))
vi.mock('@/settings-runtime', () => ({
  settingsService: { getSettings: () => ({ defaultChatModel: { model: 'test-model' } }) },
}))
vi.mock('../token-estimation/row-history-service', () => ({
  rendererTokenEstimation: { estimate: estimateMock },
}))
vi.mock('./summary-generator', () => ({ generateSummaryWithStream: generateSummaryWithStreamMock }))
vi.mock('@/stores/session/action-guard', () => ({ getSessionLockStateNow: getSessionLockStateMock }))
vi.mock('@/stores/session/message-queue', () => ({
  readConversationAnchorId: readConversationAnchorIdMock,
  enqueueCompactionRequest: enqueueCompactionRequestMock,
  hasQueuedWork: hasQueuedWorkMock,
}))

import { rendererApplication } from '@/app/renderer-application'
import { recordRequestOverhead, requestManualCompaction, runCompactionWithUIState } from './compaction'
let repository: InMemorySessionRepository
let sessions: SessionService

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

beforeEach(async () => {
  vi.clearAllMocks()
  resolveTokenEstimationPolicyMock.mockResolvedValue({ sandboxMode: false, modelSupportToolUseForFile: false })
  getDefaultStore().set(compactionUIStateMapAtom, {})
  repository = new InMemorySessionRepository()
  await repository.seedSession(testSession())
  sessions = new SessionService(repository, new SessionWriteCoordinator(repository), new SessionEventBus(), {
    createId: () => 'new-session',
  })
  getSessionHeaderMock.mockImplementation((id: string) => sessions.getSessionHeader(id))
  getSessionContextSourceMock.mockImplementation((request: Parameters<SessionService['getSessionContextSource']>[0]) =>
    sessions.getSessionContextSource(request)
  )
  commitSessionCompactionMock.mockImplementation(
    (id: string, operation: Parameters<SessionService['commitSessionCompaction']>[1]) =>
      sessions.commitSessionCompaction(id, operation)
  )
  readConversationAnchorIdMock.mockImplementation(
    async (id: string) => (await repository.readSessionConversationState({ sessionId: id }))?.lastSettledMessageId
  )
  estimateMock.mockResolvedValue({ totalTokens: 0 })
  generateSummaryWithStreamMock.mockResolvedValue({ success: true, summary: 'Summary' })
  getSessionSettingsMock.mockResolvedValue({})
  getSessionLockStateMock.mockResolvedValue({
    generatingReplyCount: 0,
    anyReplyGenerating: false,
    compactionRunning: false,
    awaitingPauseDecision: false,
  })
  hasQueuedWorkMock.mockReturnValue(false)
  enqueueCompactionRequestMock.mockReturnValue('queued')
})

afterEach(async () => {
  await waitForSessionGenerations()
  sessions.dispose()
})

describe('runCompactionWithUIState', () => {
  it('decides with one estimate, plans from a separate row context, then measures the compacted size', async () => {
    const estimate = estimateMock.mockResolvedValueOnce({ totalTokens: 1_000_000 })
    getSessionSettingsMock.mockResolvedValue({ maxContextMessageCount: 20 })
    generateSummaryWithStreamMock.mockResolvedValueOnce({ success: true, summary: 'Summary' })
    const states: string[] = []
    const unsubscribe = getDefaultStore().sub(compactionUIStateMapAtom, () =>
      states.push(getCompactionUIState('session-1').status)
    )
    try {
      const result = await runCompactionWithUIState('session-1', { kind: 'automatic' })
      expect(result.status).toBe('compacted')
      expect(estimate).toHaveBeenCalledTimes(2)
      expect(estimate.mock.calls[1][0]).toMatchObject({ constructedMessage: undefined })
      expect(getSessionHeaderMock).toHaveBeenCalledTimes(3)
      expect(getSessionContextSourceMock).toHaveBeenCalledOnce()
      expect(getSessionContextSourceMock).toHaveBeenCalledWith({
        sessionId: 'session-1',
        expectedRevision: 1,
        maxContextMessageCount: 20,
        reserveCurrentInput: true,
      })
      expect(commitSessionCompactionMock).toHaveBeenCalledOnce()
      expect(states).toEqual(['running', 'completed'])
    } finally {
      unsubscribe()
    }
  })

  it('adds the recorded tools and extra instructions to the history estimate', async () => {
    // Unknown model: 128K fallback window, 96K usable, compaction above 72K.
    estimateMock.mockResolvedValueOnce({ totalTokens: 70_000 })
    await expect(runCompactionWithUIState('session-1', { kind: 'automatic' })).resolves.toEqual({
      status: 'skipped',
      reason: 'not_needed',
    })

    recordRequestOverhead('session-1', { toolTokens: 2_000, extraSystemTokens: 3_000 })
    estimateMock.mockResolvedValueOnce({ totalTokens: 70_000 })
    generateSummaryWithStreamMock.mockResolvedValueOnce({ success: true, summary: 'Summary' })
    await expect(runCompactionWithUIState('session-1', { kind: 'automatic' })).resolves.toMatchObject({
      status: 'compacted',
    })
  })

  it('keeps completed feedback when a subsequent automatic run needs no compaction', async () => {
    estimateMock.mockResolvedValueOnce({ totalTokens: 0 })
    getDefaultStore().set(compactionUIStateMapAtom, {
      'session-1': { status: 'completed', error: null, streamingText: '', summaryMessageId: 'previous' },
    })
    await runCompactionWithUIState('session-1', { kind: 'automatic' })
    expect(getCompactionUIState('session-1').status).toBe('completed')
    expect(getSessionHeaderMock).toHaveBeenCalledOnce()
    expect(generateSummaryWithStreamMock).not.toHaveBeenCalled()
    expect(getSessionContextSourceMock).not.toHaveBeenCalled()
  })

  it('lets sending continue when automatic estimation cannot resolve the provider', async () => {
    resolveTokenEstimationPolicyMock.mockRejectedValueOnce(new Error('ModelProviderNotFoundError'))
    await expect(runCompactionWithUIState('session-1', { kind: 'automatic' })).resolves.toEqual({
      status: 'skipped',
      reason: 'not_needed',
    })
    expect(resolveTokenEstimationPolicyMock).toHaveBeenCalledOnce()
    expect(generateSummaryWithStreamMock).not.toHaveBeenCalled()
    expect(commitSessionCompactionMock).not.toHaveBeenCalled()
  })

  it('does not admit compaction during backup', async () => {
    await rendererApplication.backupOperations.run('export', async () => {
      await runCompactionWithUIState('session-1', { kind: 'manual' })
      expect(generateSummaryWithStreamMock).not.toHaveBeenCalled()
      expect(commitSessionCompactionMock).not.toHaveBeenCalled()
    })
  })

  it('forwards a one-time prompt to the summary generator', async () => {
    generateSummaryWithStreamMock.mockResolvedValue({ success: true, summary: 'Summary' })
    await runCompactionWithUIState('session-1', { kind: 'manual' }, { prompt: 'Keep exact paths.' })
    expect(generateSummaryWithStreamMock).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Keep exact paths.' }))
  })

  it('keeps the custom prompt of a failed compaction for its retry', async () => {
    generateSummaryWithStreamMock.mockResolvedValue({ success: false, error: new Error('Network error') })
    await runCompactionWithUIState('session-1', { kind: 'manual' }, { prompt: 'Keep exact paths.' })
    expect(getCompactionUIState('session-1')).toMatchObject({
      status: 'failed',
      error: 'Network error',
      retryPrompt: 'Keep exact paths.',
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
    })
    expect(countInputTokens(session.messages)).toBeGreaterThan(1_000_000)
    expect(countInputTokens(sendContext)).toBeLessThan(100)
    await repository.seedSession(session)
    getSessionSettingsMock.mockResolvedValue(session.settings)
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
    const result = await runCompactionWithUIState(session.id, { kind: 'manual' })
    expect(result, `Summary input tokens (cl100k_base): ${countInputTokens(summarizedMessages)}`).toMatchObject({
      status: 'compacted',
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

    const first = runCompactionWithUIState('session-1', { kind: 'manual' })
    await vi.waitFor(() => {
      expect(getCompactionUIState('session-1').status).toBe('running')
      expect(generateSummaryWithStreamMock).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }))
    })

    // e.g. the manual Compress modal confirmed while auto-compaction streams
    const duplicate = await runCompactionWithUIState('session-1', { kind: 'manual' })

    expect(duplicate).toMatchObject({ status: 'skipped', reason: 'busy' })
    // The duplicate must not reset the owner's UI state: fork switching stays
    // locked while the summary is still streaming.
    expect(getCompactionUIState('session-1').status).toBe('running')

    resolveSummary({ success: true, summary: 'summary text' })
    const result = await first

    expect(result).toMatchObject({ status: 'compacted' })
    expect(getCompactionUIState('session-1')).toMatchObject({
      status: 'completed',
      summaryMessageId: expect.any(String),
    })
  })
})

describe('requestManualCompaction', () => {
  const idleLocks = {
    generatingReplyCount: 0,
    anyReplyGenerating: false,
    compactionRunning: false,
    awaitingPauseDecision: false,
  }

  it('compacts in the background without holding the caller for the whole summary', async () => {
    let finishSummary = () => {}
    generateSummaryWithStreamMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSummary = () => resolve({ success: true, summary: 'Summary' })
        })
    )

    // The modal closes on this answer, so it must arrive before the summary does.
    await expect(requestManualCompaction('session-1', { force: true, prompt: 'Keep paths.' })).resolves.toBe('started')

    expect(enqueueCompactionRequestMock).not.toHaveBeenCalled()
    await vi.waitFor(() =>
      expect(generateSummaryWithStreamMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1', prompt: 'Keep paths.' })
      )
    )
    expect(hasPendingSessionGeneration('session-1')).toBe(true)
    const nextGeneration = vi.fn(async () => {})
    const nextTurn = withSessionGenerationLock('session-1', nextGeneration)
    await Promise.resolve()
    expect(nextGeneration).not.toHaveBeenCalled()
    finishSummary()
    await nextTurn
    expect(nextGeneration).toHaveBeenCalledOnce()
    expect(hasPendingSessionGeneration('session-1')).toBe(false)
  })

  it('queues when a reply wins the lock between the check and the run', async () => {
    getSessionLockStateMock
      .mockResolvedValueOnce(idleLocks)
      .mockResolvedValueOnce({ ...idleLocks, anyReplyGenerating: true })

    await expect(requestManualCompaction('session-1', { force: true, prompt: 'Keep paths.' })).resolves.toBe('queued')

    expect(generateSummaryWithStreamMock).not.toHaveBeenCalled()
    expect(enqueueCompactionRequestMock).toHaveBeenCalledWith('session-1', { prompt: 'Keep paths.', force: true }, 'a1')
  })

  it('queues instead of waiting out a submission that has no placeholder yet', async () => {
    let finishSubmission = () => {}
    const submission = withSessionGenerationLock(
      'session-1',
      () =>
        new Promise<void>((resolve) => {
          finishSubmission = resolve
        })
    )
    try {
      await expect(requestManualCompaction('session-1', { force: true })).resolves.toBe('queued')
      expect(generateSummaryWithStreamMock).not.toHaveBeenCalled()
      expect(enqueueCompactionRequestMock).toHaveBeenCalledOnce()
    } finally {
      finishSubmission()
      await submission
    }
  })

  it('rejects a failed acceptance decision so the caller can retain its input', async () => {
    getSessionLockStateMock.mockResolvedValueOnce(idleLocks).mockRejectedValueOnce(new Error('session read failed'))

    await expect(requestManualCompaction('session-1', { force: true })).rejects.toThrow('session read failed')
    expect(generateSummaryWithStreamMock).not.toHaveBeenCalled()
    expect(hasPendingSessionGeneration('session-1')).toBe(false)
  })

  it('reports failures after acceptance in the compaction status', async () => {
    const background = vi
      .spyOn(rendererApplication.backupOperations, 'runBackground')
      .mockRejectedValueOnce(new Error('background unavailable'))
    try {
      await expect(requestManualCompaction('session-1', { force: true })).resolves.toBe('started')
      await waitForSessionGenerations()
      await vi.waitFor(() =>
        expect(getCompactionUIState('session-1')).toMatchObject({ status: 'failed', error: 'background unavailable' })
      )
    } finally {
      background.mockRestore()
    }
  })

  it.each([
    ['full', 'queue-full'],
    ['persist-failed', 'queue-failed'],
  ])('returns %s rejection from the locked acceptance decision', async (enqueueResult, outcome) => {
    getSessionLockStateMock
      .mockResolvedValueOnce(idleLocks)
      .mockResolvedValueOnce({ ...idleLocks, anyReplyGenerating: true })
    enqueueCompactionRequestMock.mockReturnValue(enqueueResult)

    await expect(requestManualCompaction('session-1', { force: true, prompt: 'Keep paths.' })).resolves.toBe(outcome)
    expect(enqueueCompactionRequestMock).toHaveBeenCalledWith('session-1', { force: true, prompt: 'Keep paths.' }, 'a1')
    expect(generateSummaryWithStreamMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a streaming reply', { ...idleLocks, anyReplyGenerating: true }],
    ['a running summary', { ...idleLocks, compactionRunning: true }],
    ['a tool call waiting for a decision', { ...idleLocks, awaitingPauseDecision: true }],
  ])('queues instead of summarizing during %s', async (_case, locks) => {
    getSessionLockStateMock.mockResolvedValue(locks)

    await expect(requestManualCompaction('session-1', { force: true, prompt: 'Keep paths.' })).resolves.toBe('queued')

    expect(generateSummaryWithStreamMock).not.toHaveBeenCalled()
    expect(enqueueCompactionRequestMock).toHaveBeenCalledWith('session-1', { prompt: 'Keep paths.', force: true }, 'a1')
  })

  it('queues behind work the session already accepted', async () => {
    hasQueuedWorkMock.mockReturnValue(true)

    await expect(requestManualCompaction('session-1', { force: true })).resolves.toBe('queued')

    expect(generateSummaryWithStreamMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a full queue', 'full', 'queue-full'],
    ['a queue that cannot persist the request', 'persist-failed', 'queue-failed'],
  ])('reports %s without accepting the request', async (_case, enqueueResult, outcome) => {
    hasQueuedWorkMock.mockReturnValue(true)
    enqueueCompactionRequestMock.mockReturnValue(enqueueResult)

    await expect(requestManualCompaction('session-1', { force: true })).resolves.toBe(outcome)

    expect(generateSummaryWithStreamMock).not.toHaveBeenCalled()
  })
})
