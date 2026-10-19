// @vitest-environment jsdom
import type { SessionTokenPage } from '@chatbox/core/ports'
import type { Message } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  createPlan: vi.fn(async (request: { sessionId: string; maxContextMessageCount?: number }) => ({
    sessionId: request.sessionId,
    revision: 1,
    header: { id: request.sessionId, name: 'Tokens' },
    thread: {
      sessionId: request.sessionId,
      threadId: 't',
      seq: -1,
      createdAt: 1,
      rootMessageId: 'history',
      activeLeafMessageId: 'history',
    },
    beforeTarget: {
      userMessageCount: 1,
      hasAssistantMessage: false,
      hasLegacyCommandHistory: false,
      sandboxSeedAttachments: [],
    },
    messageIds: ['history'],
    projectionEntries: [{ role: 'user' as const }],
    canManualCompact: true,
  })),
  readPage: vi.fn(
    async (): Promise<SessionTokenPage> => ({
      sessionId: 's',
      revision: 1,
      nextOffset: null,
      entries: [{ sessionId: 's', messageId: 'history', payloadId: 'history-v1', payloadBytes: 100 }],
      messages: [
        {
          id: 'history',
          role: 'user' as const,
          contentParts: [{ type: 'text' as const, text: 'Previous history context' }],
        },
      ],
    })
  ),
  acceptCache: vi.fn(async () => {}),
  worker: vi.fn<(text: string, tokenizer: string, signal?: AbortSignal) => Promise<number>>(),
  attachment: vi.fn<typeof import('../attachment-computation').calculateAttachmentTokens>(),
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: {
      createSessionTokenPlan: mocks.createPlan,
      readSessionTokenPage: mocks.readPage,
      acceptSessionTextTokenResults: vi.fn(),
      acceptSessionTokenCacheResults: mocks.acceptCache,
    },
    sessionEvents: { subscribe: () => () => {} },
  },
}))
vi.mock('@/adapters/CurrentBlobStorage', () => ({ currentBlobStorage: { get: async () => null } }))
vi.mock('../draft-tokenizer-worker-client', () => ({ tokenizeDraftOffMainThread: mocks.worker }))
vi.mock('../attachment-computation', () => ({ calculateAttachmentTokens: mocks.attachment }))
vi.mock('../draft-tokenization', async () => {
  const actual = await vi.importActual<typeof import('../draft-tokenization')>('../draft-tokenization')
  return {
    ...actual,
    getDraftTokenizationText: vi.fn(actual.getDraftTokenizationText),
    estimateDraftTokensImmediately: vi.fn(actual.estimateDraftTokensImmediately),
  }
})
vi.mock('../analyzer', async () => {
  const actual = await vi.importActual<typeof import('../analyzer')>('../analyzer')
  return { ...actual, analyzeCurrentInputTokens: vi.fn(actual.analyzeCurrentInputTokens) }
})
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn() }) }))
import { useTokenEstimation, LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS } from '../hooks/useTokenEstimation'
import { estimateDraftTokensImmediately, getDraftTokenizationText } from '../draft-tokenization'
import { analyzeCurrentInputTokens } from '../analyzer'
const message = (text: string): Message => ({ id: 'draft', role: 'user', contentParts: [{ type: 'text', text }] })
const tick = async (ms = 1) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
beforeEach(() => {
  vi.useFakeTimers()
  mocks.createPlan.mockClear()
  mocks.readPage.mockClear()
  mocks.worker.mockReset()
  mocks.acceptCache.mockClear()
  mocks.attachment.mockReset()
  mocks.attachment.mockResolvedValue({
    success: true,
    result: {
      type: 'attachment',
      sessionId: 'new',
      messageId: 'draft',
      tokenizerType: 'default',
      tokens: 31,
      calculatedAt: 0,
    },
  })
  vi.mocked(estimateDraftTokensImmediately).mockClear()
  vi.mocked(getDraftTokenizationText).mockClear()
  vi.mocked(analyzeCurrentInputTokens).mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('renderer row history and draft tokenization', () => {
  it('defers draft text, attachments and history until first-window enablement', async () => {
    mocks.worker.mockResolvedValue(888)
    const view = renderHook(
      ({ enabled }) =>
        useTokenEstimation({
          sessionId: 's',
          enabled,
          constructedMessage: {
            ...message('long draft '.repeat(1000)),
            files: [{ id: 'f', name: 'draft.txt', storageKey: 'blob', fileType: 'text/plain' }],
          },
          modelSupportToolUseForFile: false,
        }),
      { initialProps: { enabled: false } }
    )
    await tick(500)
    expect(getDraftTokenizationText).not.toHaveBeenCalled()
    expect(estimateDraftTokensImmediately).not.toHaveBeenCalled()
    expect(analyzeCurrentInputTokens).not.toHaveBeenCalled()
    expect(mocks.attachment).not.toHaveBeenCalled()
    expect(mocks.worker).not.toHaveBeenCalled()
    expect(mocks.createPlan).not.toHaveBeenCalled()
    expect(mocks.readPage).not.toHaveBeenCalled()
    expect(view.result.current.currentInputTokens).toBe(0)
    expect(view.result.current.isCurrentInputApproximate).toBe(true)
    view.rerender({ enabled: true })
    await tick(LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS)
    expect(mocks.worker).toHaveBeenCalledTimes(1)
    expect(mocks.attachment).toHaveBeenCalledTimes(1)
    expect(view.result.current.currentInputTokens).toBe(919)
    expect(mocks.createPlan).toHaveBeenCalledTimes(1)
    expect(view.result.current.contextTokens).toBeGreaterThan(0)
    expect(view.result.current.contextMessageCount).toBe(1)
    expect(mocks.acceptCache).toHaveBeenCalledTimes(1)
    view.unmount()
  })
  it.each(['timer', 'in-flight'] as const)('cancels a disabled draft %s and attachment work', async (phase) => {
    const finishes: ((tokens: number) => void)[] = []
    const attachments: ((value: Awaited<ReturnType<typeof mocks.attachment>>) => void)[] = []
    mocks.worker.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve)
        })
    )
    mocks.attachment.mockImplementation(
      () =>
        new Promise((resolve) => {
          attachments.push(resolve)
        })
    )
    const draft: Message = {
      ...message('long draft '.repeat(1000)),
      files: [{ id: 'f', name: 'draft.txt', storageKey: 'blob', fileType: 'text/plain' }],
    }
    const view = renderHook(
      ({ enabled, text }) =>
        useTokenEstimation({
          sessionId: 's',
          enabled,
          constructedMessage: { ...draft, contentParts: message(text).contentParts },
          modelSupportToolUseForFile: false,
        }),
      { initialProps: { enabled: true, text: 'a'.repeat(6000) } }
    )
    if (phase === 'in-flight') await tick(LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS)
    const workerSignal = mocks.worker.mock.calls[0]?.[2]
    const attachmentSignal = mocks.attachment.mock.calls[0]?.[2]
    view.rerender({ enabled: false, text: 'a'.repeat(6000) })
    expect(attachmentSignal?.aborted).toBe(true)
    if (phase === 'in-flight') expect(workerSignal?.aborted).toBe(true)
    view.rerender({ enabled: false, text: 'b'.repeat(6000) })
    await tick(500)
    if (phase === 'timer') expect(mocks.worker).not.toHaveBeenCalled()
    await act(async () => {
      finishes[0]?.(999)
      attachments[0]?.({
        success: true,
        result: {
          type: 'attachment',
          sessionId: 'new',
          messageId: 'draft',
          tokenizerType: 'default',
          tokens: 999,
          calculatedAt: 0,
        },
      })
    })
    expect(view.result.current.currentInputTokens).toBe(0)
    expect(view.result.current.exactDraftTokens).toBeNull()
    view.rerender({ enabled: true, text: 'b'.repeat(6000) })
    await tick(LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS)
    expect(mocks.worker.mock.calls.at(-1)?.[0]).toBe('b'.repeat(6000))
    await act(async () => {
      finishes.at(-1)?.(7)
      attachments.at(-1)?.({
        success: true,
        result: {
          type: 'attachment',
          sessionId: 'new',
          messageId: 'draft',
          tokenizerType: 'default',
          tokens: 11,
          calculatedAt: 0,
        },
      })
    })
    expect(view.result.current.currentInputTokens).toBe(18)
    expect(view.result.current.exactDraftTokens?.tokens).toBe(7)
    view.unmount()
  })
  it('keeps history reads stable across input changes and passes the context policy', async () => {
    const view = renderHook(
      ({ text }) =>
        useTokenEstimation({
          sessionId: 's',
          enabled: true,
          maxContextMessageCount: 12,
          constructedMessage: message(text),
          model: { provider: 'openai', modelId: 'gpt-test' },
          modelSupportToolUseForFile: false,
        }),
      { initialProps: { text: 'a' } }
    )
    await tick()
    view.rerender({ text: 'ab' })
    await tick()
    expect(mocks.createPlan).toHaveBeenCalledTimes(1)
    expect(mocks.createPlan.mock.calls[0][0]).toMatchObject({ sessionId: 's', maxContextMessageCount: 12 })
    expect(view.result.current.totalTokens).toBe(
      view.result.current.currentInputTokens + view.result.current.contextTokens
    )
    view.unmount()
  })
  it('ignores historical-style draft caches and uses the selected tokenizer', () => {
    const draft = { ...message('Hello world '.repeat(40)), tokenCountMap: { default: 99999 } }
    const view = renderHook(
      ({ modelId }) =>
        useTokenEstimation({
          sessionId: null,
          constructedMessage: draft,
          model: { provider: modelId === 'deepseek-chat' ? 'deepseek' : 'openai', modelId },
          modelSupportToolUseForFile: false,
        }),
      { initialProps: { modelId: 'gpt-test' } }
    )
    const normal = view.result.current.currentInputTokens
    expect(normal).toBe(estimateDraftTokensImmediately(getDraftTokenizationText(draft), 'default'))
    view.rerender({ modelId: 'deepseek-chat' })
    expect(view.result.current.currentInputTokens).not.toBe(normal)
    view.unmount()
  })
  it('settles a long draft in the worker without changing history or attachment totals', async () => {
    let finish!: (tokens: number) => void
    mocks.worker.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const draft: Message = {
      ...message('long text '.repeat(1000)),
      contentParts: [...message('long text '.repeat(1000)).contentParts, { type: 'image', storageKey: 'image' }],
    }
    const view = renderHook(() =>
      useTokenEstimation({
        sessionId: 's',
        enabled: true,
        constructedMessage: draft,
        modelSupportToolUseForFile: false,
      })
    )
    await tick(LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS)
    const context = view.result.current.contextTokens
    const attachments = view.result.current.breakdown.currentInput.attachments
    expect(view.result.current.isDraftCalculating).toBe(true)
    expect(attachments).toBeGreaterThan(0)
    await act(async () => {
      finish(888)
    })
    expect(view.result.current.breakdown.currentInput.text).toBe(888)
    expect(view.result.current.breakdown.currentInput.attachments).toBe(attachments)
    expect(view.result.current.contextTokens).toBe(context)
    expect(view.result.current.exactDraftTokens?.tokens).toBe(888)
    expect(mocks.createPlan).toHaveBeenCalledTimes(1)
    view.unmount()
  })
  it('cancels stale long drafts and debounces typing bursts', async () => {
    const finishes: ((value: number) => void)[] = []
    mocks.worker.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve)
        })
    )
    const view = renderHook(
      ({ text }) =>
        useTokenEstimation({ sessionId: null, constructedMessage: message(text), modelSupportToolUseForFile: false }),
      { initialProps: { text: 'a'.repeat(6000) } }
    )
    await tick(LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS)
    const oldSignal = mocks.worker.mock.calls[0][2]
    view.rerender({ text: 'b'.repeat(6000) })
    view.rerender({ text: 'c'.repeat(6000) })
    expect(oldSignal?.aborted).toBe(true)
    await tick(LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS)
    expect(mocks.worker).toHaveBeenCalledTimes(2)
    expect(mocks.worker.mock.calls[1][0]).toBe('c'.repeat(6000))
    await act(async () => {
      finishes[0](123)
    })
    expect(view.result.current.exactDraftTokens).toBeNull()
    await act(async () => {
      finishes[1](456)
    })
    expect(view.result.current.exactDraftTokens?.tokens).toBe(456)
    view.unmount()
  })
  it('retains an in-flight draft across chat changes, but restarts on tokenizer changes', async () => {
    mocks.worker.mockImplementation(() => new Promise(() => {}))
    const draft = message('long text '.repeat(1000))
    const view = renderHook(
      ({ sessionId, modelId }) =>
        useTokenEstimation({
          sessionId,
          enabled: true,
          constructedMessage: draft,
          model: { provider: 'custom', modelId },
          modelSupportToolUseForFile: false,
        }),
      { initialProps: { sessionId: 'a', modelId: 'gpt-test' } }
    )
    await tick(LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS)
    const first = mocks.worker.mock.calls[0][2]
    view.rerender({ sessionId: 'b', modelId: 'gpt-test' })
    expect(first?.aborted).toBe(false)
    view.rerender({ sessionId: 'b', modelId: 'deepseek-chat' })
    expect(first?.aborted).toBe(true)
    await tick(LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS)
    expect(mocks.worker.mock.calls.at(-1)?.[1]).toBe('deepseek')
    view.unmount()
  })
})
