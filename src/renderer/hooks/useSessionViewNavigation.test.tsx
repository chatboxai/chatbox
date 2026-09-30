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
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
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
  expect(result.current.pendingNavigation?.target).toEqual({ kind: 'message', messageId: 'old-message' })
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
  expect(ref.current.scrollToMessage).toHaveBeenCalledExactlyOnceWith('target', 'smooth', 'replay')
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
  expect(result.current.pendingNavigation?.target).toEqual({ kind: 'message', messageId: 'new' })
  await act(async () => {
    finishes[0]({ id: 'A' })
    await oldRequest
  })
  expect(result.current.pendingNavigation?.target).toEqual({ kind: 'message', messageId: 'new' })
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
  expect(result.current.pendingNavigation?.target).toEqual({ kind: 'message', messageId: 'new' })
  expect(ref.current.scrollToMessage).not.toHaveBeenCalled()
  vi.mocked(ref.current.scrollToMessage).mockImplementation((id) => {
    showMessage(view, id)
    return true
  })
  view.list.style.visibility = 'visible'
  await advance(64)
  expect(ref.current.scrollToMessage).toHaveBeenCalledExactlyOnceWith('new', 'smooth', 'replay')
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

test('reports a pending complete read immediately and clears it after failure so navigation can retry', async () => {
  let reject: (error: Error) => void = () => undefined
  load.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      })
  )
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const { result } = renderHook(() => useSessionViewNavigation('A', messageListRef(), false))
  let request: Promise<void> | undefined
  act(() => {
    request = result.current.requireComplete('message')
  })
  expect(result.current.isLoadingComplete).toBe(true)
  await act(async () => {
    reject(new Error('read failed'))
    await request
  })
  expect(result.current.isLoadingComplete).toBe(false)
  expect(result.current.pendingNavigation).toBeNull()
})

test('loading complete navigation leaves scrolling and highlighting to the existing viewport restoration', async () => {
  load.mockResolvedValue({ id: 'A' })
  const ref = messageListRef()
  const { result, rerender } = renderHook(({ complete }) => useSessionViewNavigation('A', ref, complete), {
    initialProps: { complete: false },
  })
  await act(() => result.current.loadCompleteNavigation())
  expect(load).toHaveBeenCalledWith('A')
  expect(result.current.pendingNavigation).toBeNull()
  rerender({ complete: true })
  expect(ref.current.scrollToMessage).not.toHaveBeenCalled()
  expect(ref.current.scrollToTop).not.toHaveBeenCalled()
  expect(ref.current.scrollToBottom).not.toHaveBeenCalled()
  expect(result.current.isLoadingComplete).toBe(false)
})

test.each(['head', 'tail'] as const)(
  'starts a paged %s jump immediately during hydration and preserves it in the complete view',
  async (edge) => {
    vi.useFakeTimers()
    const view = mountTranscript()
    const ref = messageListRef()
    let finish: ((session: { id: string }) => void) | undefined
    load.mockClear()
    load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    Object.defineProperties(view.scroller, { scrollHeight: { value: 10000 }, clientHeight: { value: 600 } })
    vi.mocked(ref.current.scrollToTop).mockImplementation(() => {
      view.scroller.scrollTop = 0
    })
    vi.mocked(ref.current.scrollToBottom).mockImplementation(() => {
      view.scroller.scrollTop = 9400
    })
    const jumpWindow = vi.fn()
    const { result, rerender } = renderHook(({ complete }) => useSessionViewNavigation('A', ref, complete), {
      initialProps: { complete: false },
    })
    let hydration: Promise<void> | undefined
    act(() => {
      hydration = result.current.loadCompleteNavigation()
    })
    act(() => {
      result.current.jumpToEdge(edge, jumpWindow)
    })
    expect(jumpWindow).toHaveBeenCalledExactlyOnceWith(edge)
    expect(load).toHaveBeenCalledOnce()
    await act(async () => {
      finish?.({ id: 'A' })
      await hydration
    })
    view.complete()
    view.list.style.visibility = 'visible'
    rerender({ complete: true })
    await advance(64)
    expect(edge === 'head' ? ref.current.scrollToTop : ref.current.scrollToBottom).toHaveBeenCalledOnce()
    expect(view.scroller.scrollTop).toBe(edge === 'head' ? 0 : 9400)
    expect(result.current.pendingNavigation).toBeNull()
  }
)

test('uses paged edge reads while no complete load owns navigation', () => {
  const jumpWindow = vi.fn()
  const { result } = renderHook(() => useSessionViewNavigation('A', messageListRef(), false))
  act(() => {
    result.current.jumpToEdge('head', jumpWindow)
  })
  expect(jumpWindow).toHaveBeenCalledExactlyOnceWith('head')
})

test.each(['head', 'tail'] as const)(
  'retains an in-flight paged %s target when load-all replaces its window',
  async (edge) => {
    vi.useFakeTimers()
    const view = mountTranscript()
    const ref = messageListRef()
    let finishWindow: () => void = () => undefined
    let finishComplete: (session: { id: string }) => void = () => undefined
    const jumpWindow = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishWindow = resolve
        })
    )
    load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishComplete = resolve
        })
    )
    Object.defineProperties(view.scroller, { scrollHeight: { value: 10000 }, clientHeight: { value: 600 } })
    vi.mocked(ref.current.scrollToTop).mockImplementation(() => {
      view.scroller.scrollTop = 0
    })
    vi.mocked(ref.current.scrollToBottom).mockImplementation(() => {
      view.scroller.scrollTop = 9400
    })
    const { result, rerender } = renderHook(({ complete }) => useSessionViewNavigation('A', ref, complete), {
      initialProps: { complete: false },
    })
    act(() => {
      result.current.jumpToEdge(edge, jumpWindow)
    })
    expect(jumpWindow).toHaveBeenCalledExactlyOnceWith(edge)
    let hydration: Promise<void> | undefined
    act(() => {
      hydration = result.current.loadCompleteNavigation()
    })
    await act(async () => {
      finishComplete({ id: 'A' })
      await hydration
    })
    view.complete()
    view.list.style.visibility = 'visible'
    rerender({ complete: true })
    await advance(64)
    expect(edge === 'head' ? ref.current.scrollToTop : ref.current.scrollToBottom).toHaveBeenCalledOnce()
    expect(view.scroller.scrollTop).toBe(edge === 'head' ? 0 : 9400)
    await act(async () => {
      finishWindow()
      await Promise.resolve()
    })
    expect(result.current.pendingNavigation).toBeNull()
  }
)

test.each(
  ([{ kind: 'head' }, { kind: 'tail' }, { kind: 'message', messageId: 'loaded-message' }] as const).flatMap((target) =>
    [true, false].map((latestFirst) => ({ target, latestFirst }))
  )
)(
  'executes local $target.kind immediately and retains it after hydration (latest first: $latestFirst)',
  async ({ target, latestFirst }) => {
    const finishes: Array<(session: { id: string }) => void> = []
    load.mockClear()
    load.mockImplementation(() => new Promise((resolve) => finishes.push(resolve)))
    const cancelWindow = vi.fn()
    const { result } = renderHook(() => useSessionViewNavigation('A', messageListRef(), false, cancelWindow))
    act(() => {
      void result.current.loadCompleteNavigation()
      void result.current.requireComplete('older-target')
      expect(result.current.navigate(target)).toBe(false)
    })
    expect(cancelWindow).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledTimes(2)
    if (latestFirst) await act(async () => finishes[1]({ id: 'A' }))
    await act(async () => finishes[0]({ id: 'A' }))
    if (!latestFirst) {
      expect(result.current.pendingNavigation).toBeNull()
      await act(async () => finishes[1]({ id: 'A' }))
    }
    expect(result.current.pendingNavigation?.target).toEqual(target)
  }
)

test('a failed background read cannot suppress local navigation', async () => {
  let fail: ((error: Error) => void) | undefined
  load.mockClear()
  load.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
      })
  )
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const { result } = renderHook(() => useSessionViewNavigation('A', messageListRef(), false))
  let hydration: Promise<void> | undefined
  const scroll = vi.fn()
  act(() => {
    hydration = result.current.loadCompleteNavigation()
    if (!result.current.navigate({ kind: 'message', messageId: 'loaded' })) scroll()
  })
  expect(scroll).toHaveBeenCalledOnce()
  expect(load).toHaveBeenCalledOnce()
  await act(async () => {
    fail?.(new Error('read failed'))
    await hydration
  })
  expect(result.current.pendingNavigation).toBeNull()
  expect(scroll).toHaveBeenCalledOnce()
})

test('local navigation on the complete view cancels a pending replay', async () => {
  vi.useFakeTimers()
  const view = mountTranscript()
  const ref = messageListRef()
  load.mockResolvedValue({ id: 'A' })
  const { result, rerender } = renderHook(({ complete }) => useSessionViewNavigation('A', ref, complete), {
    initialProps: { complete: false },
  })
  await act(() => result.current.requireComplete('old-target'))
  view.complete()
  rerender({ complete: true })
  act(() => {
    expect(result.current.navigate({ kind: 'tail' })).toBe(false)
  })
  view.list.style.visibility = 'visible'
  await advance(80)
  expect(ref.current.scrollToMessage).not.toHaveBeenCalled()
  expect(result.current.pendingNavigation).toBeNull()
})

test('ordinary local navigation does not read complete history', () => {
  load.mockClear()
  const { result } = renderHook(() => useSessionViewNavigation('A', messageListRef(), false))
  expect(result.current.navigate({ kind: 'tail' })).toBe(false)
  expect(load).not.toHaveBeenCalled()
})

test('a canceled window read cannot clear a later complete navigation owner', async () => {
  let finishWindow: (() => void) | undefined
  let finishComplete: ((session: { id: string }) => void) | undefined
  const windowRead = new Promise<void>((resolve) => {
    finishWindow = resolve
  })
  load.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishComplete = resolve
      })
  )
  const cancelWindow = vi.fn()
  const { result } = renderHook(() => useSessionViewNavigation('A', messageListRef(), false, cancelWindow))
  act(() => result.current.jumpToEdge('head', () => windowRead))
  act(() => expect(result.current.navigate({ kind: 'tail' })).toBe(false))
  expect(cancelWindow).toHaveBeenCalledOnce()
  let complete: Promise<void> | undefined
  act(() => {
    complete = result.current.requireComplete('latest')
  })
  await act(async () => {
    finishWindow?.()
    await windowRead
  })
  expect(result.current.isLoadingComplete).toBe(true)
  await act(async () => {
    finishComplete?.({ id: 'A' })
    await complete
  })
  expect(result.current.pendingNavigation?.target).toEqual({ kind: 'message', messageId: 'latest' })
})
