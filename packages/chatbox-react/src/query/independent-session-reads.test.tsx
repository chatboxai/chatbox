// @vitest-environment jsdom
import type { SessionCommandDelta, SessionHeaderRead, SessionGenerationControl } from '@chatbox/core/ports'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import { SessionEventBus } from '@chatbox/core/application/session'
import { SessionQueryBridge } from './session-query-bridge'
import type { SessionQuerySource } from './session-query-options'
import { useSessionGenerationControl } from './use-session-generation-control'

function environment() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const unavailable = async (): Promise<never> => {
    throw new Error('Unexpected body read')
  }
  const source: SessionQuerySource = {
    getSessionHeader: unavailable,
    readSessionMessages: unavailable,
    readSessionThread: unavailable,
    readSessionTranscriptWindow: unavailable,
    readSessionThreadSummariesPage: unavailable,
    readSessionForkOptionsPage: unavailable,
    listSessionsMetaPage: unavailable,
    listArchivedSessionsMetaPage: unavailable,
  }
  const events = new SessionEventBus()
  const bridge = new SessionQueryBridge(client, source, events)
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { source, client, bridge, events, wrapper }
}

describe('independent session reads', () => {
  it('retains confirmed locks during deletion reads and drops them when generation membership changes', async () => {
    const h = environment()
    const repository = new InMemorySessionRepository()
    await repository.seedSession({
      id: 's',
      name: 'Chat',
      type: 'chat',
      messages: [
        { id: 'u', role: 'user', contentParts: [{ type: 'text', text: 'Question' }] },
        { id: 'a', role: 'assistant', contentParts: [{ type: 'text', text: 'Answer' }] },
      ],
    })
    let release: (() => void) | undefined
    let delayed: Promise<void> = Promise.resolve()
    const readSessionGenerationControl = vi.fn(
      async (request: Parameters<typeof repository.readSessionGenerationControl>[0]) => {
        await delayed
        return repository.readSessionGenerationControl(request)
      }
    )
    const initialHeader = await repository.getSessionHeader('s')
    const view = renderHook(
      ({ headerRead, ids, sessionId }) =>
        useSessionGenerationControl({
          sessionId,
          headerRead,
          bridge: h.bridge,
          compactionRunning: false,
          activeGenerationMessageIds: new Set(ids),
          source: { readSessionGenerationControl },
        }),
      { initialProps: { headerRead: initialHeader, ids: [] as string[], sessionId: 's' }, wrapper: h.wrapper }
    )
    await waitFor(() => expect(view.result.current.data?.anyReplyGenerating).toBe(false))
    const confirmed = view.result.current.data
    delayed = new Promise<void>((resolve) => {
      release = resolve
    })
    const removed = await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: { action: 'message-remove', messageId: 'a', replacementPivotId: 'replacement' },
    })
    if (removed.kind !== 'rows') throw new Error('Expected removal commit')
    await act(async () =>
      h.events.publish({
        type: 'session-command-committed',
        delta: removed.delta,
        meta: null,
        metaRevision: null,
        preserveCachedGeneratingMessages: true,
      })
    )
    await waitFor(() => expect(view.result.current.isFetching).toBe(true))
    expect(view.result.current.isPlaceholderData).toBe(true)
    expect(view.result.current.data).toBe(confirmed)
    const nextHeader = await repository.getSessionHeader('s')
    view.rerender({ headerRead: nextHeader, ids: [], sessionId: 's' })
    expect(view.result.current.data?.anyReplyGenerating).toBe(false)
    await act(async () => {
      release?.()
      await delayed
    })
    await waitFor(() => expect(view.result.current.isPlaceholderData).toBe(false))
    expect(view.result.current.data?.revision).toBe(removed.delta.revision)
    delayed = new Promise<void>((resolve) => {
      release = resolve
    })
    view.rerender({ headerRead: nextHeader, ids: ['u'], sessionId: 's' })
    expect(view.result.current.data).toBeUndefined()
    expect(view.result.current.isPlaceholderData).toBe(false)
    await act(async () => {
      release?.()
      await delayed
    })
    await waitFor(() => expect(view.result.current.data).toBeDefined())
    view.rerender({ headerRead: nextHeader, ids: ['u'], sessionId: 'other' })
    expect(view.result.current.data).toBeUndefined()
    view.unmount()
    h.bridge.dispose()
    h.client.clear()
  })

  it('uses exact row control facts and ignores unchanged runtime membership identities', async () => {
    const h = environment()
    const control: SessionGenerationControl = {
      sessionId: 's',
      revision: 1,
      activeThreadId: 't',
      generatingReplyCount: 1,
      anyReplyGenerating: true,
      awaitingPauseDecision: false,
      pausedMessageIds: [],
      latestMessageHasWebSearchSignInError: false,
      cancellableMessages: [{ messageId: 'hidden', threadId: 't', branchId: 'b', forkPivotId: 'pivot' }],
      cancellableMessageIds: ['hidden'],
    }
    const readSessionGenerationControl = vi.fn(async () => control)
    const source = { readSessionGenerationControl }
    const view = renderHook(
      ({ revision, compactionRunning, ids }) =>
        useSessionGenerationControl({
          sessionId: 's',
          headerRead: {
            header: { id: 's', name: 'Chat' },
            revision,
            activeThreadId: 't',
            control: { generatingAssistantCount: 1 },
            summary: {
              hasAutoTitleContent: false,
              messageCount: 1,
              userMessageCount: 0,
              assistantMessageCount: 1,
              fileMessageCount: 0,
              generatingMessageCount: 1,
              pausedMessageCount: 0,
              webSearchSignInErrorCount: 0,
              legacyCommandMessageCount: 0,
              steeredMessageCount: 0,
            },
          } satisfies SessionHeaderRead,
          bridge: h.bridge,
          compactionRunning,
          activeGenerationMessageIds: new Set(ids),
          source,
        }),
      { initialProps: { revision: 1, compactionRunning: false, ids: ['hidden', 'stale'] }, wrapper: h.wrapper }
    )
    await waitFor(() => expect(view.result.current.locks.generatingReplyCount).toBe(1))
    const locks = view.result.current.locks
    view.rerender({ revision: 2, compactionRunning: false, ids: ['stale', 'hidden'] })
    expect(readSessionGenerationControl).toHaveBeenCalledTimes(1)
    expect(view.result.current.locks).toBe(locks)
    view.rerender({ revision: 3, compactionRunning: true, ids: ['stale', 'hidden'] })
    expect(view.result.current.locks.compactionRunning).toBe(true)
    expect(readSessionGenerationControl).toHaveBeenCalledTimes(1)
    const delta: SessionCommandDelta = {
      sessionId: 's',
      previousRevision: 3,
      revision: 4,
      record: { id: 's', name: 'Chat', storageFormat: 'rows', activeThreadId: 't' },
      header: { id: 's', name: 'Chat' },
      previousHeader: { id: 's', name: 'Chat' },
      diff: { sessionId: 's', threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: [] } },
      appendedMessageIds: [],
    }
    await act(async () => {
      await h.events.publish({
        type: 'session-command-committed',
        delta,
        meta: null,
        metaRevision: null,
        preserveCachedGeneratingMessages: true,
      })
    })
    expect(readSessionGenerationControl).toHaveBeenCalledTimes(1)
    await act(async () => {
      await h.events.publish({
        type: 'session-command-committed',
        delta: {
          ...delta,
          previousRevision: 4,
          revision: 5,
          diff: { ...delta.diff, messages: { upsert: [], delete: ['removed'] } },
        },
        meta: null,
        metaRevision: null,
        preserveCachedGeneratingMessages: true,
      })
    })
    await waitFor(() => expect(readSessionGenerationControl).toHaveBeenCalledTimes(2))
    view.unmount()
    h.bridge.dispose()
    h.client.clear()
  })
})
