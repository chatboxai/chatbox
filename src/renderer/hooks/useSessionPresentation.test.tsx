// @vitest-environment jsdom
import type { SessionReadModel } from '@chatbox/core/ports'
import { SessionRowConflictError } from '@chatbox/core/ports'
import { encodeSessionTree } from '@chatbox/core/session/session-tree'
import { QueryKeys } from '@chatbox/react/query'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { MessageListRef } from '@/components/chat/MessageList'
import { useSessionTranscript } from './useSessionPresentation'
import { useSessionViewNavigation } from './useSessionViewNavigation'

const readWindow = vi.hoisted(() => vi.fn())
const readComplete = vi.hoisted(() => vi.fn())
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/stores/scrollActions', () => ({ navigateCompleteTranscript: vi.fn() }))
vi.mock('@/stores/uiStore', () => ({ uiStore: { getState: () => ({ transcriptNavigation: null }) } }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { readSessionMessageWindow: readWindow },
    sessionQueryBridge: { requireCompleteSessionView: readComplete },
  },
}))

function model(revision = 1): Extract<SessionReadModel, { kind: 'window' }> {
  const encoded = encodeSessionTree(
    {
      id: 's',
      name: 'Chat',
      messages: Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, role: 'user', contentParts: [] })),
    },
    { activeThreadId: 's', now: 1 }
  )
  if (!encoded.ok) throw new Error(encoded.reason)
  return {
    kind: 'window',
    header: { id: 's', name: 'Chat' },
    summary: encoded.tree.session.presentation!,
    window: {
      record: encoded.tree.session,
      revision,
      thread: encoded.tree.threads[0],
      messages: encoded.tree.messages.slice(-50),
      older: { sessionId: 's', threadId: 's', revision, beforeMessageId: 'm70' },
      newer: null,
    },
  }
}

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  readWindow.mockReset()
})

test('jumps directly to the first window, then appends newer pages without a complete session read', async () => {
  const initial = model()
  const head = {
    ...initial.window,
    messages: initial.window.messages.slice(0, 2),
    older: null,
    newer: { sessionId: 's', threadId: 's', revision: 1, afterMessageId: 'm71' },
  }
  readWindow
    .mockResolvedValueOnce(head)
    .mockResolvedValueOnce({ ...initial.window, messages: initial.window.messages.slice(2), newer: null })
  const { result } = renderHook(() => useSessionTranscript(initial), { wrapper })
  await act(() => result.current.jumpToEdge('head'))
  expect(readWindow).toHaveBeenNthCalledWith(1, { sessionId: 's', threadId: 's', edge: 'head', limit: 50 })
  expect(result.current.messages).toHaveLength(2)
  expect(result.current.hasOlder).toBe(false)
  expect(result.current.hasNewer).toBe(true)
  expect(result.current.position?.edge).toBe('head')
  act(() => result.current.loadNewer())
  await waitFor(() => expect(result.current.messages).toHaveLength(50))
  expect(result.current.messages.map((message) => message.id)).toEqual(
    initial.window.messages.map((row) => row.messageId)
  )
  expect(result.current.hasNewer).toBe(false)
  expect(client.getQueryData(QueryKeys.ChatSession('s'))).toBeUndefined()
})

test('exposes loading while paging and jumping, retains the old window on an IO error, and retries', async () => {
  const initial = model()
  let finish: ((value: typeof initial.window) => void) | undefined
  readWindow.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const { result } = renderHook(() => useSessionTranscript(initial), { wrapper })
  act(() => result.current.loadOlder())
  await waitFor(() => expect(result.current.isLoadingOlder).toBe(true))
  await act(async () => finish?.({ ...initial.window, messages: [], older: null }))
  await waitFor(() => expect(result.current.isLoadingOlder).toBe(false))
  readWindow.mockRejectedValueOnce(new Error('Disk unavailable'))
  await act(() => result.current.jumpToEdge('head'))
  expect(result.current.messages).toHaveLength(50)
  expect(result.current.error?.message).toBe('Disk unavailable')
  readWindow.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.isJumping).toBe(true))
  await act(async () => finish?.({ ...initial.window, older: null }))
  await waitFor(() => expect(result.current.isJumping).toBe(false))
  expect(result.current.error).toBeNull()
})

test('a late head jump cannot overwrite a newer tail jump', async () => {
  const initial = model()
  let finishHead: ((value: typeof initial.window) => void) | undefined
  readWindow.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishHead = resolve
      })
  )
  const { result } = renderHook(() => useSessionTranscript(initial), { wrapper })
  let headJump: Promise<void> | undefined
  act(() => {
    headJump = result.current.jumpToEdge('head')
  })
  await waitFor(() => expect(readWindow).toHaveBeenCalledTimes(1))
  readWindow.mockResolvedValueOnce(initial.window)
  await act(() => result.current.jumpToEdge('tail'))
  await act(async () => {
    finishHead?.({ ...initial.window, messages: [], older: null })
    await headJump
  })
  expect(result.current.messages).toHaveLength(50)
  expect(result.current.position?.edge).toBe('tail')
})

test('a changed revision during a head read is not installed into an old window', async () => {
  const initial = model()
  readWindow.mockResolvedValueOnce({ ...initial.window, revision: 2, messages: [], older: null })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const { result } = renderHook(() => useSessionTranscript(initial), { wrapper })
  await act(() => result.current.jumpToEdge('head'))
  expect(result.current.messages).toHaveLength(50)
  expect(result.current.error).toBeInstanceOf(SessionRowConflictError)
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.ChatSessionReadModel('s'), exact: true })
  )
})
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)

test('prepends only same-revision windows and never fills the complete cache', async () => {
  const initial = model()
  readWindow.mockResolvedValue({
    ...initial.window,
    messages: [
      { ...initial.window.messages[0], messageId: 'older', message: { id: 'older', role: 'user', contentParts: [] } },
    ],
    older: null,
  })
  const { result } = renderHook(() => useSessionTranscript(initial), { wrapper })
  expect(result.current.messages).toHaveLength(50)
  expect(result.current.windowIdentity).toEqual({ threadId: initial.window.thread.threadId, revision: 1 })
  act(() => result.current.loadOlder())
  await waitFor(() => expect(result.current.messages).toHaveLength(51))
  expect(result.current.messages[0].id).toBe('older')
  expect(result.current.windowIdentity).toEqual({ threadId: initial.window.thread.threadId, revision: 1 })
  expect(client.getQueryData(QueryKeys.ChatSession('s'))).toBeUndefined()
})

test('a revision change drops the prior page chain rather than merging it', async () => {
  const initial = model()
  readWindow.mockRejectedValue(new SessionRowConflictError('s', 1, 2))
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const { result, rerender } = renderHook(({ current }) => useSessionTranscript(current), {
    wrapper,
    initialProps: { current: initial },
  })
  act(() => result.current.loadOlder())
  await waitFor(() => expect(result.current.error).toBeTruthy())
  expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.ChatSessionReadModel('s'), exact: true })
  const fresh = model(2)
  rerender({ current: fresh })
  expect(result.current.error).toBeNull()
  expect(result.current.messages).toHaveLength(50)
  expect(result.current.messages[0].id).toBe('m70')
  expect(result.current.windowIdentity).toEqual({ threadId: fresh.window.thread.threadId, revision: 2 })
})

test('a page finishing after switching sessions cannot enter the new transcript', async () => {
  let finish: ((value: ReturnType<typeof model>['window']) => void) | undefined
  readWindow.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const initial = model()
  const { result, rerender } = renderHook(
    ({ current }: { current: SessionReadModel | undefined }) => useSessionTranscript(current),
    { wrapper, initialProps: { current: initial as SessionReadModel | undefined } }
  )
  act(() => result.current.loadOlder())
  rerender({ current: undefined })
  await act(async () => finish?.({ ...initial.window, older: null }))
  expect(result.current.messages).toEqual([])
  expect(result.current.windowIdentity).toBeUndefined()
})

test('routes failed edge retries through the navigation owner while retaining the normal default retry', async () => {
  const initial = model()
  readWindow.mockRejectedValueOnce(new Error('Disk unavailable'))
  const { result } = renderHook(() => useSessionTranscript(initial), { wrapper })
  await act(() => result.current.jumpToEdge('head'))
  const schedule = vi.fn()
  act(() => result.current.retry(schedule))
  expect(schedule).toHaveBeenCalledExactlyOnceWith('head')
  expect(readWindow).toHaveBeenCalledTimes(1)
  let finish: ((value: typeof initial.window) => void) | undefined
  readWindow.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  act(() =>
    result.current.retry((edge) => {
      void result.current.jumpToEdge(edge)
    })
  )
  await waitFor(() => expect(result.current.isJumping).toBe(true))
  await act(async () => {
    finish?.({ ...initial.window, older: null })
    await Promise.resolve()
  })
  expect(result.current.error).toBeNull()
})

test.each([{ kind: 'tail' }, { kind: 'message', messageId: 'm100' }] as const)(
  'local $kind cancels a delayed head read without hydrating history',
  async (target) => {
    const initial = model()
    let finish: ((value: typeof initial.window) => void) | undefined
    readWindow.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const ref: { current: MessageListRef } = {
      current: { scrollToTop: vi.fn(), scrollToBottom: vi.fn(), scrollToMessage: vi.fn(), setIsNewMessage: vi.fn() },
    }
    const { result } = renderHook(
      () => {
        const transcript = useSessionTranscript(initial)
        const navigation = useSessionViewNavigation('s', ref, false, transcript.cancelJump)
        return { transcript, navigation }
      },
      { wrapper }
    )
    act(() => result.current.navigation.jumpToEdge('head', result.current.transcript.jumpToEdge))
    await waitFor(() => expect(readWindow).toHaveBeenCalledTimes(1))
    expect(result.current.transcript.isJumping).toBe(true)
    act(() => expect(result.current.navigation.navigate(target)).toBe(false))
    expect(result.current.transcript.isJumping).toBe(false)
    await act(async () => finish?.({ ...initial.window, messages: [], older: null }))
    expect(result.current.transcript.messages).toHaveLength(50)
    expect(result.current.transcript.position).toBeNull()
    expect(result.current.transcript.error).toBeNull()
    expect(readComplete).not.toHaveBeenCalled()
  }
)

test('canceling a failed edge clears its retry intent', async () => {
  readWindow.mockRejectedValueOnce(new Error('Disk unavailable'))
  const initial = model()
  const { result } = renderHook(() => useSessionTranscript(initial), { wrapper })
  await act(() => result.current.jumpToEdge('head'))
  expect(result.current.error).toBeTruthy()
  act(() => result.current.cancelJump())
  expect(result.current.error).toBeNull()
  const schedule = vi.fn()
  act(() => result.current.retry(schedule))
  expect(schedule).not.toHaveBeenCalled()
})
