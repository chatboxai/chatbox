// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionEventBus } from '@chatbox/core/application/session'
import type { PortableTokenEstimationResult, TokenEstimationService } from '@chatbox/core/application/token-estimation'
import { SessionRowConflictError, type SessionCommandDelta, type SessionTokenPlan } from '@chatbox/core/ports'
import { deriveMessageFacts } from '@chatbox/core/session/session-tree'
import { useRowTokenHistory } from './use-row-token-history'
const result = (tokens = 10): PortableTokenEstimationResult => ({
  currentInputTokens: 0,
  contextTokens: tokens,
  totalTokens: tokens,
  contextMessageCount: 40,
  canManualCompact: true,
  breakdown: {
    currentInput: { text: 0, attachments: 0, toolCalls: 0 },
    context: { text: tokens, attachments: 0, toolCalls: 0 },
  },
  approximation: { currentInput: false, context: false },
})
const plan = (messageIds: string[]): SessionTokenPlan => ({
  sessionId: 's',
  revision: 1,
  header: { id: 's', name: 'Chat' },
  thread: {
    sessionId: 's',
    threadId: 't',
    threadOrder: -1,
    name: null,
    createdAt: 0,
    rootMessageId: messageIds[0] ?? null,
    activeLeafMessageId: messageIds.at(-1) ?? null,
    compactionPoints: [],
  },
  beforeTarget: {
    userMessageCount: 1,
    hasAssistantMessage: true,
    hasLegacyCommandHistory: false,
    sandboxSeedAttachments: [],
    fileResourceKeys: [],
  },
  messageIds,
  projectionEntries: messageIds.map(() => ({ role: 'user' as const })),
  canManualCompact: true,
})
function commit(revision: number, generating?: boolean): SessionCommandDelta {
  const message = {
    id: 'reply',
    role: 'assistant' as const,
    contentParts: [{ type: 'text' as const, text: 'Answer' }],
    generating,
  }
  return {
    sessionId: 's',
    previousRevision: revision - 1,
    revision,
    record: { id: 's', name: `Chat ${revision}`, storageFormat: 'rows', activeThreadId: 't' },
    header: { id: 's', name: `Chat ${revision}` },
    appendedMessageIds: [],
    diff: {
      sessionId: 's',
      threads: { upsert: [], delete: [] },
      messages: {
        delete: [],
        upsert:
          generating === undefined
            ? []
            : [
                {
                  sessionId: 's',
                  threadId: 't',
                  messageId: 'reply',
                  parentMessageId: null,
                  activeChildId: null,
                  siblingOrder: 0,
                  kind: 'message',
                  status: generating ? 'generating' : 'settled',
                  createdAt: 0,
                  updatedAt: revision,
                  branchId: null,
                  message,
                  facts: deriveMessageFacts(message),
                },
              ],
      },
    },
  }
}
async function publish(events: SessionEventBus, revision: number, generating?: boolean) {
  await events.publish({
    type: 'session-command-committed',
    delta: commit(revision, generating),
    meta: null,
    metaRevision: null,
    preserveCachedGeneratingMessages: true,
  })
}
const tick = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('independent row token subscription', () => {
  it('starts only after the transcript enables it and never restarts for equivalent input objects', async () => {
    const events = new SessionEventBus()
    const estimate = vi.fn<TokenEstimationService['estimate']>().mockResolvedValue(result())
    const service = { estimate }
    const view = renderHook(
      ({ enabled, sessionId }) =>
        useRowTokenHistory({
          service,
          events,
          enabled,
          request: { sessionId, model: { provider: 'openai', modelId: 'test' } },
        }),
      { initialProps: { enabled: false, sessionId: 's' } }
    )
    await tick()
    expect(estimate).not.toHaveBeenCalled()
    view.rerender({ enabled: true, sessionId: 's' })
    expect(estimate).not.toHaveBeenCalled()
    await tick()
    expect(estimate).toHaveBeenCalledTimes(1)
    expect(view.result.current.result?.contextTokens).toBe(10)
    view.rerender({ enabled: true, sessionId: 's' })
    await tick()
    expect(estimate).toHaveBeenCalledTimes(1)
    view.unmount()
  })
  it('re-estimates when the projection language changes', async () => {
    const estimate = vi.fn<TokenEstimationService['estimate']>().mockResolvedValue(result())
    const view = renderHook(
      ({ language }) =>
        useRowTokenHistory({
          service: { estimate },
          events: new SessionEventBus(),
          enabled: true,
          request: { sessionId: 's', language },
        }),
      { initialProps: { language: 'en' } }
    )
    await tick()
    view.rerender({ language: 'zh-Hans' })
    await tick()
    expect(estimate.mock.calls.map(([request]) => request.language)).toEqual(['en', 'zh-Hans'])
    view.unmount()
  })
  it('cancels stale session results and isolates the new session', async () => {
    let finish!: (value: PortableTokenEstimationResult) => void
    const old = new Promise<PortableTokenEstimationResult>((resolve) => {
      finish = resolve
    })
    const estimate = vi
      .fn<TokenEstimationService['estimate']>()
      .mockImplementationOnce(() => old)
      .mockResolvedValue(result(25))
    const service = { estimate }
    const events = new SessionEventBus()
    const view = renderHook(
      ({ sessionId }) => useRowTokenHistory({ service, events, enabled: true, request: { sessionId } }),
      { initialProps: { sessionId: 'first' } }
    )
    await tick()
    const signal = estimate.mock.calls[0][1]?.signal
    view.rerender({ sessionId: 'second' })
    expect(signal?.aborted).toBe(true)
    expect(view.result.current.result).toBeUndefined()
    await tick()
    await act(async () => {
      finish(result(99))
      await old
    })
    expect(estimate).toHaveBeenCalledTimes(2)
    expect(view.result.current.result?.contextTokens).toBe(25)
    view.unmount()
  })
  it('throttles numerical progress without publishing application or transcript events', async () => {
    let finish!: (value: PortableTokenEstimationResult) => void
    const pending = new Promise<PortableTokenEstimationResult>((resolve) => {
      finish = resolve
    })
    const estimate = vi.fn<TokenEstimationService['estimate']>().mockReturnValue(pending)
    const events = new SessionEventBus()
    const publish = vi.spyOn(events, 'publish')
    const service = { estimate }
    const view = renderHook(() => useRowTokenHistory({ service, events, enabled: true, request: { sessionId: 's' } }))
    await tick()
    const progress = estimate.mock.calls[0][1]?.onProgress
    act(() => {
      progress?.(result(2), 16, 40)
      progress?.(result(4), 32, 40)
    })
    expect(view.result.current.result?.contextTokens).toBe(2)
    act(() => {
      progress?.(result(8), 40, 40)
    })
    expect(view.result.current.result?.contextTokens).toBe(8)
    expect(publish).not.toHaveBeenCalled()
    await act(async () => {
      finish(result(8))
      await pending
    })
    view.unmount()
  })
  it('ignores numerical token cache publications and reestimates after relevant deletion', async () => {
    const events = new SessionEventBus()
    const estimate = vi.fn<TokenEstimationService['estimate']>().mockResolvedValue(result())
    const service = { estimate }
    const view = renderHook(() => useRowTokenHistory({ service, events, enabled: true, request: { sessionId: 's' } }))
    await tick()
    await act(async () => {
      await events.publish({ type: 'session-text-tokens-cached', sessionId: 's', results: [] })
    })
    await tick()
    expect(estimate).toHaveBeenCalledTimes(1)
    await act(async () => {
      await events.publish({ type: 'session-deleted', ids: ['s'] })
    })
    await tick()
    expect(estimate).toHaveBeenCalledTimes(2)
    view.unmount()
  })
  it('drops a retried history reply once and ignores its later stream chunks', async () => {
    const events = new SessionEventBus()
    const resolveInstructions = vi.fn(async () => 'Saved instruction')
    const estimate = vi.fn<TokenEstimationService['estimate']>().mockImplementation(async (request) => {
      expect(await request.resolveInstructions?.(plan(estimate.mock.calls.length === 1 ? ['reply'] : []))).toBe(
        'Saved instruction'
      )
      return result(estimate.mock.calls.length === 1 ? 40 : 10)
    })
    const service = { estimate }
    const view = renderHook(() =>
      useRowTokenHistory({ service, events, enabled: true, request: { sessionId: 's', resolveInstructions } })
    )
    await tick()
    await act(async () => publish(events, 2, true))
    expect(view.result.current.result?.contextTokens).toBe(40)
    await tick()
    expect(view.result.current.result?.contextTokens).toBe(10)
    for (let revision = 3; revision < 6; revision++) {
      await act(async () => publish(events, revision, true))
      await tick()
    }
    expect(estimate).toHaveBeenCalledTimes(2)
    await act(async () => publish(events, 6, false))
    await tick()
    expect(estimate).toHaveBeenCalledTimes(3)
    view.unmount()
  })
  it('coalesces revision conflicts and retains progress while the background estimate retries', async () => {
    const events = new SessionEventBus()
    const estimate = vi
      .fn<TokenEstimationService['estimate']>()
      .mockImplementationOnce(async (_request, options) => {
        options?.onProgress?.(result(7), 16, 40)
        throw new SessionRowConflictError('s', 1, 2)
      })
      .mockResolvedValue(result(24))
    const service = { estimate }
    const view = renderHook(() => useRowTokenHistory({ service, events, enabled: true, request: { sessionId: 's' } }))
    await tick()
    expect(view.result.current.result?.contextTokens).toBe(7)
    expect(view.result.current.failed).toBe(false)
    expect(view.result.current.calculating).toBe(true)
    await act(async () => {
      await publish(events, 2)
      await publish(events, 3)
      await vi.advanceTimersByTimeAsync(99)
    })
    expect(estimate).toHaveBeenCalledTimes(2)
    expect(view.result.current.result?.contextTokens).toBe(24)
    expect(view.result.current.calculating).toBe(false)
    view.unmount()
  })
  it('cancels a pending conflict retry when the first-window gate closes', async () => {
    const events = new SessionEventBus()
    const estimate = vi
      .fn<TokenEstimationService['estimate']>()
      .mockRejectedValue(new SessionRowConflictError('s', 1, 2))
    const service = { estimate }
    const view = renderHook(
      ({ enabled }) => useRowTokenHistory({ service, events, enabled, request: { sessionId: 's' } }),
      { initialProps: { enabled: true } }
    )
    await tick()
    view.rerender({ enabled: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(estimate).toHaveBeenCalledTimes(1)
    view.unmount()
  })
  it('restarts for model and instruction changes and cancels on unmount', async () => {
    const estimate = vi.fn<TokenEstimationService['estimate']>().mockResolvedValue(result())
    const service = { estimate }
    const events = new SessionEventBus()
    const view = renderHook(
      ({ modelId, instructionVersion }) =>
        useRowTokenHistory({
          service,
          events,
          enabled: true,
          instructionVersion,
          request: { sessionId: 's', model: { provider: 'custom', modelId } },
        }),
      { initialProps: { modelId: 'a', instructionVersion: 1 } }
    )
    await tick()
    view.rerender({ modelId: 'b', instructionVersion: 1 })
    await tick()
    view.rerender({ modelId: 'b', instructionVersion: 2 })
    await tick()
    expect(estimate).toHaveBeenCalledTimes(3)
    const signal = estimate.mock.calls.at(-1)?.[1]?.signal
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })
})
