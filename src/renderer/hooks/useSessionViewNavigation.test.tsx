// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import type { MessageListRef } from '@/components/chat/MessageList'
import type { TranscriptNavigation } from '@/stores/uiStore'
import { useSessionViewNavigation } from './useSessionViewNavigation'

const load = vi.hoisted(() => vi.fn())
const ui = vi.hoisted(() => ({
  messageListElement: { current: null as HTMLElement | null },
  transcriptNavigation: null as TranscriptNavigation | null,
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessionQueryBridge: { requireCompleteSessionView: load } },
}))
vi.mock('@/stores/uiStore', () => ({ uiStore: { getState: () => ui } }))
vi.mock('@/stores/sessionHelpers', () => ({ getAllMessageList: vi.fn() }))

function messageListRef(): { current: MessageListRef } {
  return {
    current: { scrollToTop: vi.fn(), scrollToBottom: vi.fn(), scrollToMessage: vi.fn(), setIsNewMessage: vi.fn() },
  }
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  ui.messageListElement.current = null
  ui.transcriptNavigation = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('drops an outstanding history navigation after A changes to B, including a later return to A', async () => {
  let finish: ((value: { id: string }) => void) | undefined
  load.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const ref = messageListRef()
  const { result, rerender } = renderHook(({ id }) => useSessionViewNavigation(id, ref, false), {
    initialProps: { id: 'A' },
  })
  let request: Promise<void> | undefined
  act(() => {
    request = result.current.requireComplete('old-message')
  })
  const wasCurrent = result.current.isCurrent
  rerender({ id: 'B' })
  expect(wasCurrent()).toBe(false)
  rerender({ id: 'A' })
  await act(async () => {
    finish?.({ id: 'A' })
    await request
  })
  expect(result.current.pendingNavigation).toBeNull()
})

test('publishes only the current route request and drops unmounted requests', async () => {
  load.mockResolvedValue({ id: 'A' })
  const ref = messageListRef()
  const { result, unmount } = renderHook(() => useSessionViewNavigation('A', ref, false))
  await act(async () => result.current.requireComplete('old-message'))
  expect(result.current.pendingNavigation?.messageId).toBe('old-message')
  const isCurrent = result.current.isCurrent
  unmount()
  expect(isCurrent()).toBe(false)
})

function mountTranscript() {
  const container = document.createElement('div')
  container.dataset.sessionId = 'A'
  container.dataset.sessionView = 'window'
  const scroller = document.createElement('div')
  scroller.dataset.virtuosoScroller = 'true'
  scroller.scrollTop = 9400
  const list = document.createElement('div')
  list.dataset.testid = 'virtuoso-item-list'
  list.style.visibility = 'hidden'
  scroller.append(list)
  container.append(scroller)
  document.body.append(container)
  ui.messageListElement.current = container
  const owner = Symbol('A')
  ui.transcriptNavigation = { sessionId: 'A', owner, view: 'window', scrollToIndex: vi.fn(() => true) }
  const complete = () => {
    container.dataset.sessionView = 'complete'
    ui.transcriptNavigation = { sessionId: 'A', owner, view: 'complete', scrollToIndex: vi.fn(() => true) }
  }
  return { container, scroller, list, complete }
}

test('finishes a requested top navigation after delayed complete-list anchor initialization', async () => {
  vi.useFakeTimers()
  const view = mountTranscript()
  const ref = messageListRef()
  vi.mocked(ref.current.scrollToTop).mockImplementation(() => {
    view.scroller.scrollTop = 0
  })
  load.mockResolvedValue({ id: 'A' })
  const { result, rerender } = renderHook(({ complete }) => useSessionViewNavigation('A', ref, complete), {
    initialProps: { complete: false },
    wrapper: StrictMode,
  })
  await act(async () => result.current.requireComplete())
  view.complete()
  rerender({ complete: true })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32)
  })
  const pendingBeforeInitialization = result.current.pendingNavigation !== null
  await act(async () => {
    await vi.advanceTimersByTimeAsync(48)
    view.scroller.scrollTop = 9400
    view.list.style.visibility = 'visible'
    await vi.advanceTimersByTimeAsync(64)
  })
  expect(view.scroller.scrollTop).toBe(0)
  expect(pendingBeforeInitialization).toBe(true)
  expect(ref.current.scrollToTop).toHaveBeenCalledTimes(1)
  expect(result.current.pendingNavigation).toBeNull()
})

function showMessage(view: ReturnType<typeof mountTranscript>, id: string) {
  const message = document.createElement('div')
  message.id = id
  view.list.append(message)
  vi.spyOn(view.container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 500))
  vi.spyOn(message, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 400, 100))
}

async function advance(milliseconds: number) {
  await act(async () => vi.advanceTimersByTimeAsync(milliseconds))
}

test('uses the MessageList message navigation after readiness to preserve highlighting and default behavior', async () => {
  vi.useFakeTimers()
  const view = mountTranscript()
  const ref = messageListRef()
  vi.mocked(ref.current.scrollToMessage).mockImplementation((id) => {
    showMessage(view, id)
    return true
  })
  load.mockResolvedValue({ id: 'A' })
  const { result, rerender } = renderHook(({ complete }) => useSessionViewNavigation('A', ref, complete), {
    initialProps: { complete: false },
  })
  await act(async () => result.current.requireComplete('target'))
  view.complete()
  rerender({ complete: true })
  await advance(80)
  expect(ref.current.scrollToMessage).not.toHaveBeenCalled()
  view.list.style.visibility = 'visible'
  await advance(64)
  expect(ref.current.scrollToMessage).toHaveBeenCalledExactlyOnceWith('target')
  expect(ref.current.scrollToTop).not.toHaveBeenCalled()
  expect(result.current.pendingNavigation).toBeNull()
})

test('a later same-session request owns navigation even when the earlier read completes last', async () => {
  const ref = messageListRef()
  const finishes: Array<(session: { id: string }) => void> = []
  load.mockImplementation(() => new Promise((resolve) => finishes.push(resolve)))
  const { result } = renderHook(() => useSessionViewNavigation('A', ref, false))
  let oldRequest: Promise<void> | undefined
  let newRequest: Promise<void> | undefined
  act(() => {
    oldRequest = result.current.requireComplete('old')
    newRequest = result.current.requireComplete('new')
  })
  await act(async () => {
    finishes[1]({ id: 'A' })
    await newRequest
  })
  expect(result.current.pendingNavigation?.messageId).toBe('new')
  await act(async () => {
    finishes[0]({ id: 'A' })
    await oldRequest
  })
  expect(result.current.pendingNavigation?.messageId).toBe('new')
})

test('completion of an already dispatched request cannot finish its newer same-session successor', async () => {
  vi.useFakeTimers()
  const view = mountTranscript()
  const ref = messageListRef()
  load.mockResolvedValue({ id: 'A' })
  const { result, rerender } = renderHook(({ complete }) => useSessionViewNavigation('A', ref, complete), {
    initialProps: { complete: false },
  })
  await act(async () => result.current.requireComplete())
  view.complete()
  view.list.style.visibility = 'visible'
  rerender({ complete: true })
  expect(ref.current.scrollToTop).toHaveBeenCalledTimes(1)
  view.list.style.visibility = 'hidden'
  await act(async () => result.current.requireComplete('new'))
  await advance(64)
  expect(result.current.pendingNavigation?.messageId).toBe('new')
  expect(ref.current.scrollToMessage).not.toHaveBeenCalled()
  vi.mocked(ref.current.scrollToMessage).mockImplementation((id) => {
    showMessage(view, id)
    return true
  })
  view.list.style.visibility = 'visible'
  await advance(64)
  expect(ref.current.scrollToMessage).toHaveBeenCalledExactlyOnceWith('new')
  expect(result.current.pendingNavigation).toBeNull()
})

test.each(['unmount', 'A-B-A'] as const)('cancels a layout wait on %s', async (cancellation) => {
  vi.useFakeTimers()
  const view = mountTranscript()
  const ref = messageListRef()
  load.mockResolvedValue({ id: 'A' })
  const { result, rerender, unmount } = renderHook(({ id, complete }) => useSessionViewNavigation(id, ref, complete), {
    initialProps: { id: 'A', complete: false },
  })
  await act(async () => result.current.requireComplete())
  const staleRequest = result.current.requireComplete
  view.complete()
  rerender({ id: 'A', complete: true })
  await advance(48)
  if (cancellation === 'unmount') unmount()
  else {
    rerender({ id: 'B', complete: true })
    rerender({ id: 'A', complete: true })
  }
  const readCount = load.mock.calls.length
  await act(async () => staleRequest())
  expect(load).toHaveBeenCalledTimes(readCount)
  view.list.style.visibility = 'visible'
  await advance(64)
  expect(ref.current.scrollToTop).not.toHaveBeenCalled()
})

test.each(['layout', 'target', 'rejected', 'throw'] as const)(
  'ends a failed %s navigation without replaying its command',
  async (failure) => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = mountTranscript()
    const ref = messageListRef()
    vi.mocked(ref.current.scrollToMessage).mockImplementation(() => {
      if (failure === 'throw') throw new Error('Navigation failed')
      return failure !== 'rejected'
    })
    load.mockResolvedValue({ id: 'A' })
    const { result, rerender } = renderHook(({ complete }) => useSessionViewNavigation('A', ref, complete), {
      initialProps: { complete: false },
    })
    await act(async () => result.current.requireComplete('missing-target'))
    view.complete()
    if (failure !== 'layout') view.list.style.visibility = 'visible'
    rerender({ complete: true })
    await advance(1100)
    expect(result.current.pendingNavigation).toBeNull()
    expect(ref.current.scrollToMessage).toHaveBeenCalledTimes(failure === 'layout' ? 0 : 1)
    expect(failure === 'throw' ? error : warning).toHaveBeenCalledTimes(1)
    view.list.style.visibility = 'visible'
    showMessage(view, 'missing-target')
    await advance(100)
    expect(ref.current.scrollToMessage).toHaveBeenCalledTimes(failure === 'layout' ? 0 : 1)
  }
)

test.each(['missing', 'error'] as const)(
  'does not create a pending navigation for a %s complete read',
  async (failure) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    if (failure === 'error') load.mockRejectedValue(new Error('Read failed'))
    else load.mockResolvedValue(null)
    const ref = messageListRef()
    const { result } = renderHook(() => useSessionViewNavigation('A', ref, false))
    await act(async () => result.current.requireComplete())
    expect(result.current.pendingNavigation).toBeNull()
    expect(ref.current.scrollToTop).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(failure === 'error' ? 1 : 0)
  }
)
