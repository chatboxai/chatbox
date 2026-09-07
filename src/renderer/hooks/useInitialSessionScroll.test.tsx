// @vitest-environment jsdom
import type { SessionReadModel } from '@chatbox/core/ports'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useInitialSessionScroll } from './useInitialSessionScroll'

const scrollToBottom = vi.hoisted(() => vi.fn())
vi.mock('@/stores/scrollActions', () => ({ scrollToBottom }))

type ViewKind = SessionReadModel['kind'] | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  scrollToBottom.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
const advance = (milliseconds = 200) => act(() => vi.advanceTimersByTime(milliseconds))

test.each(['/', '/settings'] as const)(
  'returning through %s leaves a restored window reading position untouched',
  async (path) => {
    let readingPosition = 20
    scrollToBottom.mockImplementation(() => {
      readingPosition = 49
    })
    const root = createRootRoute({ component: Outlet })
    const session = createRoute({
      getParentRoute: () => root,
      path: '/session/$sessionId',
      component: () => {
        const { sessionId } = session.useParams()
        useInitialSessionScroll(sessionId, 'window')
        return <div>Session</div>
      },
    })
    const router = createRouter({
      routeTree: root.addChildren([
        session,
        createRoute({ getParentRoute: () => root, path: '/', component: () => <div>Home</div> }),
        createRoute({ getParentRoute: () => root, path: '/settings', component: () => <div>Settings</div> }),
      ]),
      history: createMemoryHistory({ initialEntries: ['/session/A'] }),
    })
    await act(async () => {
      await router.load()
    })
    render(<RouterProvider router={router} />)
    advance()
    await act(async () => {
      await router.navigate({ to: path })
    })
    advance()
    readingPosition = 20
    await act(async () => {
      await router.navigate({ to: '/session/$sessionId', params: { sessionId: 'A' } })
    })
    advance()
    expect(readingPosition).toBe(20)
    expect(scrollToBottom).not.toHaveBeenCalled()
  }
)

test.each([undefined, 'window'] as const)('does not scroll an unready or window presentation: %s', (kind) => {
  renderHook(() => useInitialSessionScroll('A', kind))
  advance()
  expect(scrollToBottom).not.toHaveBeenCalled()
})

test('uses the current presentation at the mount deadline without scheduling after it', () => {
  const { rerender } = renderHook(({ kind }: { kind: ViewKind }) => useInitialSessionScroll('A', kind), {
    initialProps: { kind: undefined as ViewKind },
  })
  advance(100)
  rerender({ kind: 'window' })
  advance(100)
  rerender({ kind: 'full' })
  advance(500)
  expect(scrollToBottom).not.toHaveBeenCalled()
})

test('preserves the full-view mount scroll once after 200ms, including delayed data', () => {
  const { rerender } = renderHook(({ kind }: { kind: ViewKind }) => useInitialSessionScroll('A', kind), {
    initialProps: { kind: undefined as ViewKind },
  })
  advance(100)
  rerender({ kind: 'full' })
  advance(99)
  expect(scrollToBottom).not.toHaveBeenCalled()
  advance(1)
  expect(scrollToBottom).toHaveBeenCalledExactlyOnceWith('auto')
  rerender({ kind: 'full' })
  advance(1000)
  expect(scrollToBottom).toHaveBeenCalledTimes(1)
})

test('leaves window-to-full history navigation in control of its anchor', () => {
  const { rerender } = renderHook(({ kind }: { kind: ViewKind }) => useInitialSessionScroll('A', kind), {
    initialProps: { kind: 'window' as ViewKind },
  })
  advance(100)
  rerender({ kind: 'full' })
  advance(100)
  expect(scrollToBottom).not.toHaveBeenCalled()
})

test('cancels the old route timer when session params switch, including return to the original id', () => {
  const { rerender } = renderHook(({ id }) => useInitialSessionScroll(id, 'full'), { initialProps: { id: 'A' } })
  advance(100)
  rerender({ id: 'B' })
  expect(vi.getTimerCount()).toBe(0)
  rerender({ id: 'A' })
  advance(1000)
  expect(scrollToBottom).not.toHaveBeenCalled()
})

test('cancels an unmounted route timer before another session mounts', () => {
  const first = renderHook(() => useInitialSessionScroll('A', 'full'))
  advance(100)
  first.unmount()
  expect(vi.getTimerCount()).toBe(0)
  renderHook(() => useInitialSessionScroll('B', 'window'))
  advance(500)
  expect(scrollToBottom).not.toHaveBeenCalled()
})

test('keeps one full-view mount timer through StrictMode effect replay', () => {
  renderHook(() => useInitialSessionScroll('A', 'full'), { wrapper: StrictMode })
  advance()
  expect(scrollToBottom).toHaveBeenCalledExactlyOnceWith('auto')
})

test('waits for an explicit recovery retry before scheduling the full-view mount scroll', () => {
  const { rerender } = renderHook(({ enabled }) => useInitialSessionScroll('A', 'full', enabled), {
    initialProps: { enabled: false },
  })
  advance(500)
  expect(scrollToBottom).not.toHaveBeenCalled()
  rerender({ enabled: true })
  advance()
  expect(scrollToBottom).toHaveBeenCalledExactlyOnceWith('auto')
})

test('cancels a pending mount scroll when startup recovery becomes required', () => {
  const { rerender } = renderHook(({ enabled }) => useInitialSessionScroll('A', 'full', enabled), {
    initialProps: { enabled: true },
  })
  advance(100)
  rerender({ enabled: false })
  advance(500)
  expect(scrollToBottom).not.toHaveBeenCalled()
})
