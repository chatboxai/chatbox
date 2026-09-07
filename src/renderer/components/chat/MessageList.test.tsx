// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { Message, Session } from '@shared/types'
import { MessageRoleEnum } from '@shared/types'
import { type CSSProperties, createRef, type ReactNode, StrictMode, type UIEventHandler } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { scrollToIndex as navigateToIndex } from '@/stores/scrollActions'
import type { TranscriptNavigation } from '@/stores/uiStore'
import { act, cleanup, fireEvent, render, waitFor } from '@/test-utils'
import MessageList, { clearScrollPositionCache, type MessageListRef } from './MessageList'
import { getWindowScrollPosition } from './window-scroll-cache'

const virtuosoScrollToIndexMock = vi.hoisted(() => vi.fn())
const virtuosoScrollToMock = vi.hoisted(() => vi.fn())
const virtuosoAtBottom = vi.hoisted(() => ({ value: true }))
const virtuosoGetStateMock = vi.hoisted(() => vi.fn())
const virtuosoMountedGetStates = vi.hoisted(() => [] as ReturnType<typeof vi.fn>[])
const virtuosoRestoreStates = vi.hoisted(() => [] as unknown[])
const virtuosoPositioning = vi.hoisted(
  () =>
    [] as Array<{
      initialTopMostItemIndex?: unknown
      initialScrollTop?: number
      rangeChanged?: (range: { startIndex: number }) => void
      totalListHeightChanged?: (height: number) => void
      firstItemIndex?: number
    }>
)
const navigationState = vi.hoisted(() => ({
  transcriptNavigation: null as TranscriptNavigation | null,
  setTranscriptNavigation: (value: TranscriptNavigation | null) => {
    navigationState.transcriptNavigation = value
  },
  setMessageListElement: vi.fn(),
  widthFull: true,
  sessionAgentModeMap: {},
  agentModeSmartSwitchingDefault: false,
  agentModeLastSelected: 'off',
  promptCacheBreakConfirmDismissed: {},
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return {
    Virtuoso: React.forwardRef(
      (
        props: {
          data: unknown[]
          itemContent: (index: number, item: unknown) => ReactNode
          atTopStateChange?: (value: boolean) => void
          atBottomStateChange?: (value: boolean) => void
          onScroll?: UIEventHandler<HTMLDivElement>
          style?: CSSProperties
          firstItemIndex?: number
          restoreStateFrom?: unknown
          initialTopMostItemIndex?: unknown
          initialScrollTop?: number
          rangeChanged?: (range: { startIndex: number }) => void
          totalListHeightChanged?: (height: number) => void
          components?: {
            Header?: React.ComponentType<{ context?: object }>
            Footer?: React.ComponentType<{ context?: object }>
          }
          context?: object
        },
        ref
      ) => {
        virtuosoRestoreStates.push(props.restoreStateFrom)
        virtuosoPositioning.push(props)
        const [getState] = React.useState(() => {
          const method = vi.fn((callback: (state: unknown) => void) => virtuosoGetStateMock(callback))
          virtuosoMountedGetStates.push(method)
          return method
        })
        React.useImperativeHandle(ref, () => ({
          scrollTo: virtuosoScrollToMock,
          scrollToIndex: virtuosoScrollToIndexMock,
          getState,
        }))
        React.useEffect(() => {
          props.atTopStateChange?.(false)
          props.atBottomStateChange?.(virtuosoAtBottom.value)
        }, [props])
        const Header = props.components?.Header
        const Footer = props.components?.Footer
        return (
          <div data-testid="virtuoso" data-virtuoso-scroller onScroll={props.onScroll} style={props.style}>
            {Header && <Header context={props.context} />}
            <div data-testid="virtuoso-item-list">
              {props.data.map((item, index) => {
                const itemKey =
                  item && typeof item === 'object' && 'key' in item && typeof item.key === 'string'
                    ? item.key
                    : `item-${index}`

                return (
                  <div data-index={index} key={itemKey}>
                    {props.itemContent(index + (props.firstItemIndex ?? 0), item)}
                  </div>
                )
              })}
            </div>
            {Footer && <Footer context={props.context} />}
          </div>
        )
      }
    ),
  }
})

const messageRenderLog = vi.hoisted(() => [] as Array<{ id: string; readOnly?: boolean }>)
const messageButtonGroupLog = vi.hoisted(() => [] as Array<{ id: string; buttonGroup?: string }>)
const promptCacheDeleteResolversLog = vi.hoisted(
  () => [] as Array<(messageId: string, target: 'message' | 'summary') => boolean>
)
const actionMenuItemsLog = vi.hoisted(() => [] as Array<Array<{ text?: string; divider?: boolean }>>)
vi.mock('./Message', () => ({
  default: ({
    msg,
    readOnly,
    buttonGroup,
    shouldConfirmPromptCacheDelete,
  }: {
    msg: Message
    readOnly?: boolean
    buttonGroup?: string
    shouldConfirmPromptCacheDelete: (messageId: string, target: 'message' | 'summary') => boolean
  }) => {
    messageRenderLog.push({ id: msg.id, readOnly })
    messageButtonGroupLog.push({ id: msg.id, buttonGroup })
    promptCacheDeleteResolversLog.push(shouldConfirmPromptCacheDelete)
    return <div data-testid={`message-${msg.id}`}>{msg.role}</div>
  },
}))

const minimapRenderLog = vi.hoisted(() => [] as unknown[])
vi.mock('./MessageMinimapRail', () => ({
  default: (props: { anchors: unknown }) => {
    minimapRenderLog.push(props.anchors)
    return null
  },
}))

vi.mock('./MessageNavigation', () => ({
  default: () => null,
  ScrollToBottomButton: () => null,
}))

vi.mock('./SummaryMessage', () => ({
  default: () => null,
}))

vi.mock('./ForkMarkerMessage', () => ({
  default: () => null,
}))

vi.mock('./ForkGroup', () => ({
  default: ({ msgId }: { msgId: string }) => <div data-testid={`fork-group-${msgId}`} />,
}))

vi.mock('../ActionMenu', () => ({
  default: ({ children, items }: { children: ReactNode; items: Array<{ text?: string; divider?: boolean }> }) => {
    actionMenuItemsLog.push(items)
    return <>{children}</>
  },
}))

vi.mock('../common/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('../common/ScalableIcon', () => ({
  ScalableIcon: () => null,
}))

const isSmallScreenMock = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => isSmallScreenMock.value,
}))

const previewTextSpy = vi.hoisted(() => ({ calls: 0 }))
vi.mock('./message-navigation-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./message-navigation-utils')>()
  return {
    ...actual,
    getMessagePreviewText: (...args: Parameters<typeof actual.getMessagePreviewText>) => {
      previewTextSpy.calls++
      return actual.getMessagePreviewText(...args)
    },
  }
})

vi.mock('@/hooks/useNeedRoomForWinControls', () => ({
  platformTypeAtom: {},
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' '),
  getLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

// Partially mock jotai: platformTypeAtom is stubbed as a plain object (see
// above), so useAtomValue answers 'darwin' for it; real atoms — like the
// compaction selectAtom inside useSessionLockState, which must stay a real
// boolean — go through the actual implementation on the default store.
vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>()
  const isRealAtom = (candidate: unknown): boolean =>
    typeof (candidate as { read?: unknown } | null | undefined)?.read === 'function'
  return {
    ...actual,
    useAtomValue: ((anAtom: unknown, options?: unknown) =>
      isRealAtom(anAtom)
        ? // biome-ignore lint/correctness/useHookAtTopLevel: mock delegates to the real hook; per render the branch is stable for a given atom identity
          actual.useAtomValue(anAtom as Parameters<typeof actual.useAtomValue>[0], options as never)
        : 'darwin') as typeof actual.useAtomValue,
    useSetAtom: () => vi.fn(),
  }
})

vi.mock('@/stores/atoms', () => ({
  showThreadHistoryDrawerAtom: {},
}))

const settingsState = vi.hoisted(() => ({
  autoCollapseCodeBlock: false,
  hideSystemPromptMessage: false,
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => settingsState,
  },
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: typeof navigationState) => unknown) => selector(navigationState),
  uiStore: { getState: () => navigationState },
}))

vi.mock('@/stores/session/forks', () => ({
  deleteFork: vi.fn(),
  expandFork: vi.fn(),
  switchFork: vi.fn(),
  switchForkTo: vi.fn(),
}))
vi.mock('@/stores/session/messages', () => ({
  removeMessage: vi.fn(),
}))
vi.mock('@/stores/session/threads', () => ({
  moveThreadToConversations: vi.fn(),
  removeThread: vi.fn(),
  switchThread: vi.fn(),
}))

vi.mock('@/stores/sessionHelpers', () => ({
  getAllMessageList: (session: Session) => [
    ...(session.threads ?? []).flatMap((thread) => thread.messages),
    ...session.messages,
  ],
  getCurrentThreadHistoryHash: (session: Session) => {
    const entries: Record<string, unknown> = {}
    for (const thread of session.threads ?? []) {
      if (!thread.messages[0]) continue
      entries[thread.messages[0].id] = {
        id: thread.id,
        name: thread.name,
        firstMessageId: thread.messages[0].id,
        messageCount: thread.messages.length,
      }
    }
    if (session.threads?.length && session.messages[0]) {
      entries[session.messages[0].id] = {
        id: session.id,
        name: session.threadName || '',
        firstMessageId: session.messages[0].id,
        messageCount: session.messages.length,
      }
    }
    return entries
  },
}))

vi.mock('../Markdown', () => ({
  BlockCodeCollapsedStateProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

function message(id: string, role: Message['role'], content: string): Message {
  return {
    id,
    role,
    contentParts: [{ type: 'text', text: content }],
    timestamp: 1,
  }
}

describe('MessageList new message layout', () => {
  function navigation() {
    const current = navigationState.transcriptNavigation
    if (!current) throw new Error('Missing transcript navigation')
    return current
  }

  function navigationView(id: string, complete = true) {
    const header = { id, name: 'Chat' }
    const messages = [message(`${id}-reply`, MessageRoleEnum.Assistant, 'Reply')]
    return (
      <MantineProvider>
        {complete ? (
          <MessageList currentSession={{ ...header, messages }} />
        ) : (
          <MessageList transcript={{ header, messages }} />
        )}
      </MantineProvider>
    )
  }

  test('keeps only the latest mounted owner active and does not clear it during an older cleanup', () => {
    const first = render(navigationView('owner-first'))
    const oldOwner = navigation()
    const second = render(navigationView('owner-second'))
    const newOwner = navigation()
    expect(oldOwner.scrollToIndex({ index: 0, align: 'start', behavior: 'smooth' })).toBe(false)
    first.unmount()
    expect(navigation()).toBe(newOwner)
    expect(newOwner.scrollToIndex({ index: 0, align: 'start', behavior: 'smooth' })).toBe(true)
    second.unmount()
    expect(navigationState.transcriptNavigation).toBeNull()
    expect(newOwner.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })).toBe(false)
  })

  test('invalidates capabilities across session and window-to-complete view changes', () => {
    const mounted = render(navigationView('owner-a', false))
    const windowOwner = navigation()
    mounted.rerender(navigationView('owner-a'))
    const completeOwner = navigation()
    expect(completeOwner.view).toBe('complete')
    expect(completeOwner.owner).toBe(windowOwner.owner)
    expect(windowOwner.scrollToIndex({ index: 0, align: 'start', behavior: 'auto' })).toBe(false)
    mounted.rerender(navigationView('owner-b'))
    mounted.rerender(navigationView('owner-a'))
    expect(navigation().owner).not.toBe(completeOwner.owner)
    expect(completeOwner.scrollToIndex({ index: 0, align: 'start', behavior: 'auto' })).toBe(false)
    expect(navigation().scrollToIndex({ index: 0, align: 'start', behavior: 'auto' })).toBe(true)
  })

  test('registers a usable owner after StrictMode setup and cleanup replay', () => {
    const mounted = render(<StrictMode>{navigationView('strict-owner')}</StrictMode>)
    expect(navigation().scrollToIndex({ index: 0, align: 'start', behavior: 'auto' })).toBe(true)
    mounted.unmount()
    expect(navigationState.transcriptNavigation).toBeNull()
  })

  test('LAST resumes follow while an actual upward user scroll still stops it', () => {
    const mounted = render(navigationView('resume-owner'))
    const scroller = mounted.getByTestId('virtuoso')
    Object.defineProperties(scroller, {
      scrollTop: { configurable: true, writable: true, value: 7000 },
      scrollHeight: { configurable: true, value: 7532 },
      clientHeight: { configurable: true, value: 532 },
    })
    fireEvent.scroll(scroller)
    virtuosoAtBottom.value = false
    act(() => navigateToIndex(0, 'start', 'smooth'))
    scroller.scrollTop = 6990
    fireEvent.scroll(scroller)
    expect(virtuosoScrollToMock).not.toHaveBeenCalled()
    act(() => navigateToIndex('LAST', 'end', 'smooth'))
    expect(virtuosoScrollToIndexMock).toHaveBeenLastCalledWith({ index: 'LAST', align: 'end', behavior: 'smooth' })
    scroller.scrollTop = 6980
    fireEvent.scroll(scroller)
    expect(virtuosoScrollToMock).toHaveBeenCalledWith({ top: 6980, behavior: 'auto' })
  })

  test('does not retarget history on measured growth until LAST resumes follow', async () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
    try {
      render(navigationView('measured-history'))
      act(() => navigateToIndex(0, 'start', 'smooth'))
      requestFrame.mockClear()
      act(() => {
        virtuosoPositioning.at(-1)?.totalListHeightChanged?.(7532)
        virtuosoPositioning.at(-1)?.totalListHeightChanged?.(8591)
      })
      expect(requestFrame).not.toHaveBeenCalled()
      expect(virtuosoScrollToMock).not.toHaveBeenCalled()
      act(() => {
        navigateToIndex('LAST', 'end', 'smooth')
        virtuosoPositioning.at(-1)?.totalListHeightChanged?.(9000)
      })
      await waitFor(() => expect(virtuosoScrollToMock).toHaveBeenCalledWith(expect.objectContaining({ top: Infinity })))
    } finally {
      requestFrame.mockRestore()
    }
  })

  function measuredWindow(sessionId: string, scrollTop: number, count = 50) {
    clearScrollPositionCache(sessionId)
    const header = { id: sessionId, name: 'Chat' }
    const messages = Array.from({ length: count }, (_, index) =>
      message(`warm-${index}`, MessageRoleEnum.Assistant, 'Reply')
    )
    const windowIdentity = { threadId: 'thread', revision: 1 }
    const view = (identity = windowIdentity, rows = messages, position?: { id: number; edge: 'head' | 'tail' }) => (
      <MantineProvider env="test">
        <MessageList transcript={{ header, messages: rows }} windowIdentity={identity} windowPosition={position} />
      </MantineProvider>
    )
    const mounted = render(view())
    const viewport = mounted.container.querySelector<HTMLElement>('[data-session-view]')
    if (!viewport) throw new Error('Missing viewport')
    const scroller = mounted.getByTestId('virtuoso')
    Object.defineProperties(scroller, {
      scrollTop: { configurable: true, writable: true, value: count * 100 - 600 },
      scrollHeight: { configurable: true, value: count * 100 },
      clientHeight: { configurable: true, value: 600 },
    })
    const bounds = (top: number, height: number): DOMRect => ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 400,
      width: 400,
      x: 0,
      y: top,
      toJSON: () => ({}),
    })
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(bounds(0, 600))
    for (const item of Array.from(mounted.container.querySelectorAll<HTMLElement>('[data-index]'))) {
      vi.spyOn(item, 'getBoundingClientRect').mockImplementation(() =>
        bounds(Number(item.dataset.index) * 100 - scroller.scrollTop, 100)
      )
    }
    fireEvent.scroll(scroller)
    scroller.scrollTop = scrollTop
    fireEvent.scroll(scroller)
    virtuosoGetStateMock.mockImplementation((callback: (state: unknown) => void) =>
      callback({
        ranges: [{ startIndex: 0, endIndex: Infinity, size: 100 }],
        scrollTop: scroller.scrollTop,
      })
    )
    return { mounted, view, viewport, scroller, messages, windowIdentity }
  }

  test.each([2012, 4400])('restores a warm window at the saved reading position %s', (scrollTop) => {
    const first = measuredWindow(`warm-position-${scrollTop}`, scrollTop)
    first.mounted.unmount()
    expect(getWindowScrollPosition(`warm-position-${scrollTop}`)?.snapshot?.scrollTop).toBe(scrollTop)
    const unrelated = render(
      <MantineProvider>
        <MessageList transcript={{ header: { id: 'other', name: 'Other' }, messages: [] }} />
      </MantineProvider>
    )
    unrelated.unmount()
    virtuosoScrollToMock.mockClear()
    const returned = render(first.view())
    expect(virtuosoRestoreStates.at(-1)).toEqual({ ranges: [{ startIndex: 0, endIndex: 49, size: 100 }], scrollTop })
    expect(virtuosoPositioning.at(-1)?.initialTopMostItemIndex).toBeUndefined()
    expect(returned.container.querySelectorAll('[data-index]')).toHaveLength(50)
    expect(virtuosoScrollToMock).not.toHaveBeenCalled()
  })

  test('saves the current Virtuoso instance after an edge jump remount', () => {
    const first = measuredWindow('jump-remount-cache', 2012)
    const oldGetState = virtuosoMountedGetStates.at(-1)!
    oldGetState.mockImplementation((callback: (state: unknown) => void) =>
      callback({ ranges: [{ startIndex: 0, endIndex: 49, size: 100 }], scrollTop: 2012 })
    )
    first.mounted.rerender(first.view(first.windowIdentity, first.messages, { id: 1, edge: 'head' }))
    const currentGetState = virtuosoMountedGetStates.at(-1)!
    expect(currentGetState).not.toBe(oldGetState)
    const scroller = first.mounted.getByTestId('virtuoso')
    Object.defineProperties(scroller, {
      scrollTop: { configurable: true, writable: true, value: 1012 },
      scrollHeight: { configurable: true, value: 5000 },
      clientHeight: { configurable: true, value: 600 },
    })
    for (const item of Array.from(first.mounted.container.querySelectorAll<HTMLElement>('[data-index]'))) {
      vi.spyOn(item, 'getBoundingClientRect').mockImplementation(() => {
        const top = Number(item.dataset.index) * 100 - scroller.scrollTop
        return {
          x: 0,
          y: top,
          top,
          bottom: top + 100,
          left: 0,
          right: 400,
          width: 400,
          height: 100,
          toJSON: () => ({}),
        }
      })
    }
    currentGetState.mockImplementation((callback: (state: unknown) => void) =>
      callback({ ranges: [{ startIndex: 0, endIndex: 49, size: 100 }], scrollTop: 1012 })
    )
    oldGetState.mockClear()
    first.mounted.unmount()
    expect(oldGetState).not.toHaveBeenCalled()
    expect(currentGetState).toHaveBeenCalledOnce()
    expect(getWindowScrollPosition('jump-remount-cache')?.snapshot?.scrollTop).toBe(1012)
    render(first.view())
    expect(virtuosoRestoreStates.at(-1)).toEqual({
      ranges: [{ startIndex: 0, endIndex: 49, size: 100 }],
      scrollTop: 1012,
    })
  })

  test.each(['revision', 'layout', 'range', 'schema'])('does not reuse warm geometry after a %s change', (change) => {
    const sessionId = `warm-mismatch-${change}`
    const first = measuredWindow(sessionId, 2012)
    first.mounted.unmount()
    if (change === 'layout')
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 380 })
    if (change === 'schema') {
      const entry = getWindowScrollPosition(sessionId)
      if (!entry) throw new Error('Missing window snapshot')
      entry.version = 2
    }
    render(
      first.view(
        change === 'revision' ? { ...first.windowIdentity, revision: 2 } : first.windowIdentity,
        change === 'range' ? first.messages.slice(10) : first.messages
      )
    )
    expect(virtuosoRestoreStates.at(-1)).toBeUndefined()
    expect(virtuosoPositioning.at(-1)?.initialTopMostItemIndex).toEqual({
      index: change === 'range' ? 10 : 20,
      align: 'start',
    })
  })

  test('keeps the reading anchor after local message expansion', () => {
    const first = measuredWindow('warm-expanded', 2012)
    fireEvent.click(first.mounted.getByTestId('message-warm-20'))
    first.mounted.unmount()
    render(first.view())
    expect(virtuosoRestoreStates.at(-1)).toBeUndefined()
    expect(virtuosoPositioning.at(-1)?.initialTopMostItemIndex).toEqual({ index: 20, align: 'start' })
  })

  test('does not repopulate an explicitly cleared session when its window unmounts', () => {
    const first = measuredWindow('warm-cleared', 2012)
    clearScrollPositionCache('warm-cleared')
    first.mounted.unmount()
    expect(getWindowScrollPosition('warm-cleared')).toBeUndefined()
  })

  test('keeps a large paged window anchor with bounded cache metadata', () => {
    const first = measuredWindow('warm-large', 2012, 1000)
    virtuosoGetStateMock.mockClear()
    first.mounted.unmount()
    expect(virtuosoGetStateMock).not.toHaveBeenCalled()
    expect(getWindowScrollPosition('warm-large')?.snapshot).toBeNull()
    expect(getWindowScrollPosition('warm-large')?.key.signature).toBeNull()
    render(first.view())
    expect(virtuosoRestoreStates.at(-1)).toBeUndefined()
    expect(virtuosoPositioning.at(-1)?.initialTopMostItemIndex).toEqual({ index: 20, align: 'start' })
  })

  test('uses the reading anchor instead of dimensions while a warm viewport is unmeasured', () => {
    const first = measuredWindow('warm-unmeasured-return', 2012)
    first.mounted.unmount()
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 0 })
    render(first.view())
    expect(virtuosoRestoreStates.at(-1)).toBeUndefined()
    expect(virtuosoPositioning.at(-1)?.initialTopMostItemIndex).toEqual({ index: 20, align: 'start' })
  })

  test.each(['hidden', 'zero', 'empty', 'stale'])('does not save an unready %s window', (state) => {
    const sessionId = `warm-unready-${state}`
    const first = measuredWindow(sessionId, 2012)
    if (state === 'hidden') first.mounted.getByTestId('virtuoso-item-list').style.visibility = 'hidden'
    if (state === 'zero') Object.defineProperty(first.viewport, 'clientWidth', { configurable: true, value: 0 })
    if (state === 'empty')
      virtuosoGetStateMock.mockImplementation((callback: (value: unknown) => void) =>
        callback({ ranges: [], scrollTop: 0 })
      )
    if (state === 'stale')
      virtuosoGetStateMock.mockImplementation((callback: (value: unknown) => void) =>
        callback({ ranges: [{ startIndex: 0, endIndex: Infinity, size: 100 }], scrollTop: 0 })
      )
    first.mounted.unmount()
    expect(getWindowScrollPosition(sessionId)).toBeUndefined()
    render(first.view())
    expect(virtuosoRestoreStates.at(-1)).toBeUndefined()
  })

  test.each([
    ['local', 7000],
    ['local', 6999.75],
    ['global', 7000],
    ['global', 6999.75],
    ['global', 6990],
  ] as const)('does not pin %s smooth message navigation after a first scroll at %s', (entry, firstScrollTop) => {
    const ref = createRef<MessageListRef>()
    const mounted = render(
      <MantineProvider>
        <MessageList
          ref={ref}
          transcript={{
            header: { id: 'smooth-message-navigation', name: 'Chat' },
            messages: Array.from({ length: 50 }, (_, index) =>
              message(`navigation-${index}`, MessageRoleEnum.Assistant, 'Reply')
            ),
          }}
        />
      </MantineProvider>
    )
    const scroller = mounted.getByTestId('virtuoso')
    Object.defineProperties(scroller, {
      scrollTop: { configurable: true, writable: true, value: 7000 },
      scrollHeight: { configurable: true, value: 7532 },
      clientHeight: { configurable: true, value: 532 },
    })
    fireEvent.scroll(scroller)
    virtuosoAtBottom.value = false
    act(() =>
      entry === 'local'
        ? ref.current?.scrollToMessage('navigation-40', 'smooth')
        : navigateToIndex(40, 'center', 'smooth')
    )
    expect(virtuosoScrollToIndexMock).toHaveBeenCalledWith({ index: 40, align: 'center', behavior: 'smooth' })

    scroller.scrollTop = firstScrollTop
    fireEvent.scroll(scroller)
    scroller.scrollTop = 6990
    fireEvent.scroll(scroller)

    expect(virtuosoScrollToMock).not.toHaveBeenCalled()
  })

  test('follows a cold tail measurement when the delayed bottom notification only reports false', async () => {
    virtuosoAtBottom.value = false
    const mounted = render(
      <MantineProvider>
        <MessageList
          transcript={{
            header: { id: 'cold-measured-tail', name: 'Chat' },
            messages: Array.from({ length: 50 }, (_, index) =>
              message(`measured-${index}`, MessageRoleEnum.Assistant, 'Reply')
            ),
          }}
        />
      </MantineProvider>
    )
    const scroller = mounted.getByTestId('virtuoso')
    Object.defineProperties(scroller, {
      scrollTop: { configurable: true, value: 7000 },
      scrollHeight: { configurable: true, value: 7532 },
      clientHeight: { configurable: true, value: 532 },
    })
    act(() => virtuosoPositioning.at(-1)?.totalListHeightChanged?.(7532))
    fireEvent.scroll(scroller)
    act(() => virtuosoPositioning.at(-1)?.totalListHeightChanged?.(8591))

    await waitFor(() => expect(virtuosoScrollToMock).toHaveBeenCalledWith(expect.objectContaining({ top: Infinity })))
    expect(mounted.container.querySelectorAll('[data-index]')).toHaveLength(50)
  })

  test('keeps a tail view at the tail when complete data replaces a window', () => {
    const header = { id: 'tail-view-transition', name: 'Chat' }
    const messages = Array.from({ length: 100 }, (_, index) =>
      message(`tail-${index}`, MessageRoleEnum.Assistant, 'Reply')
    )
    virtuosoGetStateMock.mockImplementation((callback: (snapshot: unknown) => void) =>
      callback({ ranges: [{ startIndex: 0, endIndex: 99, size: 40 }], scrollTop: 400 })
    )
    const earlierVisit = render(
      <MantineProvider>
        <MessageList currentSession={{ ...header, messages }} />
      </MantineProvider>
    )
    earlierVisit.unmount()
    virtuosoGetStateMock.mockReset()
    const mounted = render(
      <MantineProvider>
        <MessageList transcript={{ header, messages: messages.slice(-50) }} />
      </MantineProvider>
    )
    act(() => {
      virtuosoPositioning.at(-1)?.rangeChanged?.({ startIndex: 1000000000 - 12 })
    })

    mounted.rerender(
      <MantineProvider>
        <MessageList currentSession={{ ...header, messages }} />
      </MantineProvider>
    )

    expect(virtuosoRestoreStates.at(-1)).toBeUndefined()
    expect(virtuosoPositioning.at(-1)?.initialTopMostItemIndex).toEqual({ index: 'LAST', align: 'end' })
  })
  test('preserves the visible item and its offset when a window reader receives complete data', () => {
    const header = { id: 'reading-view-transition', name: 'Chat' }
    const messages = Array.from({ length: 100 }, (_, index) =>
      message(`reading-${index}`, MessageRoleEnum.Assistant, 'Reply')
    )
    const mounted = render(
      <MantineProvider>
        <MessageList transcript={{ header, messages: messages.slice(-50) }} />
      </MantineProvider>
    )
    const container = mounted.container.querySelector<HTMLElement>('[data-session-id]')
    if (!container) throw new Error('Missing session viewport')
    const scroller = mounted.getByTestId('virtuoso')
    const bounds = (top: number, bottom: number): DOMRect => ({
      top,
      bottom,
      left: 0,
      right: 100,
      width: 100,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    })
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(bounds(0, 60))
    for (const item of Array.from(mounted.container.querySelectorAll<HTMLElement>('[data-index]'))) {
      const top = (Number(item.dataset.index) - 44) * 40 - 20
      vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(bounds(top, top + 40))
    }
    Object.defineProperties(scroller, {
      scrollTop: { configurable: true, writable: true, value: 2000 },
      scrollHeight: { configurable: true, value: 2060 },
      clientHeight: { configurable: true, value: 60 },
    })
    fireEvent.scroll(scroller)
    scroller.scrollTop = 1900
    fireEvent.scroll(scroller)

    mounted.rerender(
      <MantineProvider>
        <MessageList currentSession={{ ...header, messages }} />
      </MantineProvider>
    )

    expect(virtuosoPositioning.at(-1)?.initialTopMostItemIndex).toEqual({ index: 94, align: 'start', offset: 20 })
  })
  test('does not restore a window snapshot into a later complete list', () => {
    virtuosoGetStateMock.mockImplementation((callback: (snapshot: unknown) => void) =>
      callback({ ranges: [{ startIndex: 0, endIndex: 49, size: 40 }], scrollTop: 1000 })
    )
    const header = { id: 'scroll-cache-isolation', name: 'Chat' }
    const messages = [message('last', MessageRoleEnum.User, 'Question')]
    const mounted = render(
      <MantineProvider>
        <MessageList transcript={{ header, messages }} />
      </MantineProvider>
    )
    mounted.unmount()
    expect(virtuosoGetStateMock).not.toHaveBeenCalled()
    const complete = render(
      <MantineProvider>
        <MessageList currentSession={{ ...header, messages }} />
      </MantineProvider>
    )
    expect(virtuosoRestoreStates.at(-1)).toBeUndefined()
    complete.unmount()
    expect(virtuosoGetStateMock).toHaveBeenCalled()
    virtuosoGetStateMock.mockReset()
  })
  test('renders window messages with normal actions and explicitly expands off-window navigation', () => {
    const requireComplete = vi.fn()
    const ref = createRef<MessageListRef>()
    render(
      <MantineProvider>
        <MessageList
          ref={ref}
          transcript={{
            header: {
              id: 'window-session',
              name: 'Window',
              type: 'chat',
              settings: { agentMode: { value: 'off', locked: false, lockReason: null } },
            },
            messages: [
              message('tail-user', MessageRoleEnum.User, 'Question'),
              message('tail-reply', MessageRoleEnum.Assistant, 'Reply'),
            ],
          }}
          hasOlder
          onRequireComplete={requireComplete}
        />
      </MantineProvider>
    )
    expect(messageRenderLog.at(-1)).toEqual({ id: 'tail-reply', readOnly: false })
    expect(messageButtonGroupLog.at(-1)).toEqual({ id: 'tail-reply', buttonGroup: 'always' })
    expect(ref.current?.scrollToMessage('old-message')).toBe(true)
    expect(requireComplete).toHaveBeenCalledWith('old-message')
    act(() => ref.current?.scrollToTop())
    expect(requireComplete).toHaveBeenCalledWith()
  })
  test('uses bounded edge navigation and displays loading and the true conversation boundary', () => {
    const jump = vi.fn()
    const requireComplete = vi.fn()
    const ref = createRef<MessageListRef>()
    const transcript = {
      header: { id: 'edges', name: 'Edges' },
      messages: [message('m0', MessageRoleEnum.User, 'First')],
    }
    const view = render(
      <MantineProvider>
        <MessageList
          ref={ref}
          transcript={transcript}
          hasOlder
          hasNewer
          isLoadingOlder
          onJumpToEdge={jump}
          onRequireComplete={requireComplete}
        />
      </MantineProvider>
    )
    expect(view.getByText('Loading...')).toBeTruthy()
    act(() => ref.current?.scrollToTop())
    act(() => ref.current?.scrollToBottom())
    expect(jump.mock.calls).toEqual([['head'], ['tail']])
    expect(requireComplete).not.toHaveBeenCalled()
    view.rerender(
      <MantineProvider>
        <MessageList
          ref={ref}
          transcript={transcript}
          hasNewer
          windowPosition={{ id: 1, edge: 'head' }}
          onJumpToEdge={jump}
        />
      </MantineProvider>
    )
    expect(view.getByText('Beginning of conversation')).toBeTruthy()
    expect(virtuosoPositioning.at(-1)?.initialTopMostItemIndex).toBeUndefined()
    expect(virtuosoPositioning.at(-1)?.initialScrollTop).toBe(0)
  })

  test('keeps existing virtual indices on append and moves only the first index on prepend', () => {
    const header = { id: 'bidirectional', name: 'Bidirectional' }
    const messages = [message('m1', MessageRoleEnum.User, 'One'), message('m2', MessageRoleEnum.Assistant, 'Two')]
    const view = render(
      <MantineProvider>
        <MessageList transcript={{ header, messages }} />
      </MantineProvider>
    )
    const initialIndex = virtuosoPositioning.at(-1)?.firstItemIndex
    const appended = [...messages, message('m3', MessageRoleEnum.User, 'Three')]
    view.rerender(
      <MantineProvider>
        <MessageList transcript={{ header, messages: appended }} />
      </MantineProvider>
    )
    expect(virtuosoPositioning.at(-1)?.firstItemIndex).toBe(initialIndex)
    view.rerender(
      <MantineProvider>
        <MessageList
          transcript={{ header, messages: [message('m0', MessageRoleEnum.Assistant, 'Zero'), ...appended] }}
        />
      </MantineProvider>
    )
    expect(virtuosoPositioning.at(-1)?.firstItemIndex).toBe(initialIndex! - 1)
  })

  test('does not follow page growth after scrolling to the loaded boundary with newer messages remaining', () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
    try {
      const transcript = {
        header: { id: 'page-follow', name: 'History' },
        messages: [message('p0', MessageRoleEnum.User, 'First')],
      }
      const mounted = render(
        <MantineProvider>
          <MessageList transcript={transcript} hasNewer />
        </MantineProvider>
      )
      const scroller = mounted.getByTestId('virtuoso')
      Object.defineProperties(scroller, {
        scrollTop: { configurable: true, writable: true, value: 6500 },
        scrollHeight: { configurable: true, value: 7532 },
        clientHeight: { configurable: true, value: 532 },
      })
      fireEvent.scroll(scroller)
      scroller.scrollTop = 7000
      fireEvent.scroll(scroller)
      requestFrame.mockClear()
      act(() => {
        virtuosoPositioning.at(-1)?.totalListHeightChanged?.(7532)
        virtuosoPositioning.at(-1)?.totalListHeightChanged?.(15000)
      })
      expect(requestFrame).not.toHaveBeenCalled()
      expect(virtuosoScrollToMock).not.toHaveBeenCalled()
    } finally {
      requestFrame.mockRestore()
    }
  })

  beforeEach(() => {
    settingsState.hideSystemPromptMessage = false
    isSmallScreenMock.value = false
    messageRenderLog.length = 0
    messageButtonGroupLog.length = 0
    promptCacheDeleteResolversLog.length = 0
    actionMenuItemsLog.length = 0
    virtuosoScrollToIndexMock.mockClear()
    virtuosoScrollToMock.mockClear()
    virtuosoAtBottom.value = true
    virtuosoGetStateMock.mockClear()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 600,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 400 })

    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  test('uses an explicit mobile end inset while preserving the desktop scrollbar gutter', () => {
    isSmallScreenMock.value = true
    const session: Session = {
      id: 'mobile-session',
      type: 'chat',
      name: 'Mobile session',
      messages: [message('assistant-message', MessageRoleEnum.Assistant, 'answer')],
    }

    const { container, getByTestId, rerender } = render(
      <MantineProvider>
        <MessageList currentSession={session} />
      </MantineProvider>
    )

    expect(getByTestId('virtuoso').style.scrollbarGutter).toBe('auto')
    expect(container.querySelector<HTMLElement>('[data-index="0"] > div')?.style.paddingInlineEnd).toBe('16px')

    isSmallScreenMock.value = false
    rerender(
      <MantineProvider>
        <MessageList currentSession={{ ...session }} />
      </MantineProvider>
    )

    expect(getByTestId('virtuoso').style.scrollbarGutter).toBe('stable')
    expect(container.querySelector<HTMLElement>('[data-index="0"] > div')?.style.paddingInlineEnd).toBe('')
    const desktopViewport = container.querySelector<HTMLElement>('[data-session-view]')
    expect(desktopViewport?.classList.contains('h-full')).toBe(true)
    expect(desktopViewport?.parentElement?.classList.contains('flex-col')).toBe(false)
  })

  describe('readable mobile navigation', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      isSmallScreenMock.value = true
      virtuosoAtBottom.value = false
    })

    afterEach(() => {
      cleanup()
      vi.useRealTimers()
    })

    function openNavigation(complete = true, instantTransitions = true) {
      const session: Session = {
        id: 'readable-navigation',
        name: 'Chat',
        messages: [0, 1, 2].map((index) => message(`question-${index}`, MessageRoleEnum.User, 'Question')),
      }
      const view = () => (
        <MantineProvider env={instantTransitions ? 'test' : undefined}>
          {complete ? (
            <MessageList currentSession={{ ...session }} />
          ) : (
            <MessageList transcript={{ header: { id: session.id, name: session.name }, messages: session.messages }} />
          )}
        </MantineProvider>
      )
      const mounted = render(view())
      const viewport = mounted.container.querySelector<HTMLElement>('[data-session-view]')
      if (!viewport) throw new Error('Missing body viewport')
      const scroller = mounted.getByTestId('virtuoso')
      Object.defineProperties(scroller, {
        scrollTop: { configurable: true, writable: true, value: 8000 },
        scrollHeight: { configurable: true, value: 8500 },
        clientHeight: { configurable: true, writable: true, value: 500 },
      })
      const scroll = (top: number) => {
        scroller.scrollTop = top
        fireEvent.scroll(scroller)
        act(() => vi.advanceTimersByTime(256))
      }
      scroll(8000)
      scroll(7900)
      return { ...mounted, scroller, scroll, viewport, view }
    }

    test.each([true, false])('keeps navigation outside the stable body scrollport (complete: %s)', (complete) => {
      const mounted = openNavigation(complete)
      const { viewport } = mounted
      const row = mounted.getByRole('button', { name: 'Return to the top' }).parentElement
      if (!row) throw new Error('Missing navigation row')
      expect(viewport.contains(row)).toBe(false)
      expect(row.nextElementSibling).toBe(viewport)
      expect(row.classList.contains('absolute')).toBe(false)
      expect(row.classList.contains('shrink-0')).toBe(true)
      expect(viewport.parentElement?.classList.contains('flex-col')).toBe(true)
      expect(viewport.classList.contains('min-h-0')).toBe(true)
      expect(viewport.classList.contains('flex-1')).toBe(true)
      virtuosoScrollToMock.mockClear()
      virtuosoScrollToIndexMock.mockClear()
      act(() => vi.advanceTimersByTime(4000))
      expect(mounted.queryByRole('button', { name: 'Return to the top' })).toBeNull()
      expect(mounted.getByTestId('virtuoso')).toBe(mounted.scroller)
      expect(mounted.container.querySelector('[data-session-view]')).toBe(viewport)
      expect(mounted.scroller.scrollTop).toBe(7900)
      expect(virtuosoScrollToMock).not.toHaveBeenCalled()
      expect(virtuosoScrollToIndexMock).not.toHaveBeenCalled()
    })

    test('aligns previous-message navigation to the body viewport', () => {
      const mounted = openNavigation()
      const { viewport } = mounted
      vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 120, 400, 480))
      const items = mounted.container.querySelectorAll<HTMLElement>('[data-index]')
      vi.spyOn(items[0], 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 60, 400, 50))
      vi.spyOn(items[1], 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 110, 400, 100))
      fireEvent.click(mounted.getByRole('button', { name: 'Back to previous message' }))
      expect(virtuosoScrollToIndexMock).toHaveBeenLastCalledWith({ index: 1, align: 'start', behavior: 'smooth' })
    })

    test('ignores a bottom clamp when the scrollport grows, while retaining real upward scroll cancellation', () => {
      const mounted = openNavigation()
      act(() => navigateToIndex('LAST', 'end', 'auto'))
      mounted.scroll(8000)
      expect(mounted.queryByRole('button', { name: 'Return to the top' })).toBeNull()
      Object.defineProperty(mounted.scroller, 'clientHeight', { configurable: true, value: 530 })
      virtuosoScrollToMock.mockClear()
      mounted.scroll(7970)
      expect(mounted.queryByRole('button', { name: 'Return to the top' })).toBeNull()
      expect(virtuosoScrollToMock).not.toHaveBeenCalled()
      mounted.scroll(7960)
      expect(mounted.getByRole('button', { name: 'Return to the top' })).toBeDefined()
      expect(virtuosoScrollToMock).toHaveBeenCalledWith({ top: 7960, behavior: 'auto' })
    })

    test('saves the reading anchor and warm layout against the body scrollport', () => {
      const first = measuredWindow('mobile-toolbar-anchor', 2012)
      act(() => vi.advanceTimersByTime(256))
      expect(first.mounted.getByRole('button', { name: 'Return to the top' })).toBeDefined()
      Object.defineProperty(first.viewport, 'clientHeight', { configurable: true, value: 570 })
      vi.spyOn(first.viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 30, 400, 570))
      for (const item of Array.from(first.viewport.querySelectorAll<HTMLElement>('[data-index]'))) {
        vi.spyOn(item, 'getBoundingClientRect').mockImplementation(
          () => new DOMRect(0, 30 + Number(item.dataset.index) * 100 - first.scroller.scrollTop, 400, 100)
        )
      }
      first.mounted.unmount()
      const saved = getWindowScrollPosition('mobile-toolbar-anchor')
      expect(saved?.anchor).toEqual({ messageId: 'warm-20', offset: 12 })
      expect(saved && JSON.parse(saved.layout).slice(0, 2)).toEqual([400, 570])
      render(first.view())
      expect(virtuosoPositioning.at(-1)?.initialTopMostItemIndex).toEqual({ index: 20, align: 'start' })
    })

    test('removes an animated navigation row immediately when the viewport becomes desktop-sized', () => {
      const mounted = openNavigation(true, false)
      for (let frame = 0; frame < 3; frame++) act(() => vi.advanceTimersByTime(150))
      const row = mounted.getByRole('button', { name: 'Return to the top' }).parentElement
      expect(row?.style.transitionProperty).toContain('opacity')
      isSmallScreenMock.value = false
      mounted.rerender(mounted.view())
      expect(mounted.queryByRole('button', { name: 'Return to the top' })).toBeNull()
      expect(mounted.viewport.classList.contains('h-full')).toBe(true)
      expect(mounted.viewport.parentElement?.classList.contains('flex-col')).toBe(false)
      expect(mounted.getByTestId('virtuoso')).toBe(mounted.scroller)
    })
  })

  test('renders legacy picture session messages as read-only', () => {
    const session: Session = {
      id: 'picture-session',
      type: 'picture',
      name: 'Legacy pictures',
      messages: [message('picture-message', MessageRoleEnum.Assistant, 'historical image')],
    }

    render(
      <MantineProvider>
        <MessageList currentSession={session} />
      </MantineProvider>
    )

    expect(messageRenderLog).toContainEqual({ id: 'picture-message', readOnly: true })
  })

  test('hides system prompt messages when the display setting is enabled', () => {
    settingsState.hideSystemPromptMessage = true
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      messages: [
        message('system-message', MessageRoleEnum.System, 'system prompt'),
        message('user-message', MessageRoleEnum.User, 'question'),
      ],
    }

    const { container } = render(
      <MantineProvider>
        <MessageList currentSession={session} />
      </MantineProvider>
    )

    expect(messageRenderLog).not.toContainEqual(expect.objectContaining({ id: 'system-message' }))
    expect(messageRenderLog).toContainEqual({ id: 'user-message', readOnly: false })
    expect(container.querySelector('[aria-hidden="true"].h-px')).not.toBeNull()
  })

  test('hides system prompt messages in work mode regardless of the display setting', () => {
    settingsState.hideSystemPromptMessage = false
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      settings: { agentMode: { value: 'on', locked: false, lockReason: null } },
      messages: [
        message('system-message', MessageRoleEnum.System, 'system prompt'),
        message('user-message', MessageRoleEnum.User, 'question'),
      ],
    }

    render(
      <MantineProvider>
        <MessageList currentSession={session} />
      </MantineProvider>
    )

    expect(messageRenderLog).not.toContainEqual(expect.objectContaining({ id: 'system-message' }))
    expect(messageRenderLog).toContainEqual({ id: 'user-message', readOnly: false })
  })

  test('preserves thread labels and Virtuoso indices when system prompts are hidden', () => {
    settingsState.hideSystemPromptMessage = true
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      threadName: 'Current Thread',
      threads: [
        {
          id: 'archived-thread',
          name: 'Archived Thread',
          createdAt: 1,
          messages: [
            message('archived-system', MessageRoleEnum.System, 'archived system prompt'),
            message('archived-user', MessageRoleEnum.User, 'archived question'),
            message('archived-assistant', MessageRoleEnum.Assistant, 'archived answer'),
          ],
        },
      ],
      messages: [
        message('current-system', MessageRoleEnum.System, 'current system prompt'),
        message('current-user', MessageRoleEnum.User, 'current question'),
        message('current-assistant', MessageRoleEnum.Assistant, 'current answer'),
      ],
    }

    const { container } = render(
      <MantineProvider>
        <MessageList currentSession={session} />
      </MantineProvider>
    )

    expect(container.textContent).toContain('Archived Thread')
    expect(container.textContent).toContain('Current Thread')
    expect(container.querySelector('[data-testid="message-archived-system"]')).toBeNull()
    expect(container.querySelector('[data-testid="message-current-system"]')).toBeNull()
    expect(
      container
        .querySelector('[data-testid="message-archived-assistant"]')
        ?.closest('[data-index]')
        ?.getAttribute('data-index')
    ).toBe('2')
  })

  test('keeps stored thread labels visible without structural actions in work mode', () => {
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      threadName: 'Current Thread',
      settings: { agentMode: { value: 'on', locked: true, lockReason: null } },
      threads: [
        {
          id: 'archived-thread',
          name: 'Archived Thread',
          createdAt: 1,
          messages: [
            message('archived-system', MessageRoleEnum.System, 'archived system prompt'),
            message('archived-user', MessageRoleEnum.User, 'archived question'),
            message('archived-assistant', MessageRoleEnum.Assistant, 'archived answer'),
          ],
        },
      ],
      messages: [
        message('current-system', MessageRoleEnum.System, 'current system prompt'),
        message('current-user', MessageRoleEnum.User, 'current question'),
        message('current-assistant', MessageRoleEnum.Assistant, 'current answer'),
      ],
    }

    const { container } = render(
      <MantineProvider>
        <MessageList currentSession={session} />
      </MantineProvider>
    )

    expect(container.textContent).toContain('Archived Thread')
    expect(container.textContent).toContain('Current Thread')
    expect(container.querySelector('[data-testid="message-archived-user"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="message-current-user"]')).not.toBeNull()
    const threadActions = actionMenuItemsLog.flat().flatMap((item) => (item.text ? [item.text] : []))
    expect(threadActions).toContain('Edit Thread Name')
    expect(threadActions).toContain('Show in Thread List')
    expect(threadActions).not.toContain('Continue this thread')
    expect(threadActions).not.toContain('Move to Conversations')
    expect(threadActions).not.toContain('delete')
  })

  test('applies cache-break delete policy only to the active context path', () => {
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      settings: { agentMode: { value: 'on', locked: true, lockReason: null } },
      threads: [
        {
          id: 'archived-thread',
          name: 'Archived Thread',
          createdAt: 1,
          messages: [message('archived-user', MessageRoleEnum.User, 'old question')],
        },
      ],
      messages: [
        message('current-user', MessageRoleEnum.User, 'current question'),
        message('current-assistant', MessageRoleEnum.Assistant, 'x'.repeat(4000)),
      ],
    }

    render(
      <MantineProvider>
        <MessageList currentSession={session} />
      </MantineProvider>
    )

    const resolveDeletePolicy = promptCacheDeleteResolversLog.at(-1)
    expect(resolveDeletePolicy).toBeDefined()
    expect(resolveDeletePolicy?.('archived-user', 'message')).toBe(false)
    expect(resolveDeletePolicy?.('current-user', 'message')).toBe(true)
    expect(resolveDeletePolicy?.('current-assistant', 'message')).toBe(false)
  })

  test('excludes messages outside the configured provider context from cache-break policy', () => {
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      settings: {
        agentMode: { value: 'on', locked: true, lockReason: null },
        maxContextMessageCount: 1,
      },
      messages: [
        message('old-assistant', MessageRoleEnum.Assistant, 'x'.repeat(4000)),
        message('current-user', MessageRoleEnum.User, 'current question'),
        message('current-assistant', MessageRoleEnum.Assistant, 'current answer'),
      ],
    }

    render(
      <MantineProvider>
        <MessageList currentSession={session} />
      </MantineProvider>
    )

    const resolveDeletePolicy = promptCacheDeleteResolversLog.at(-1)
    expect(resolveDeletePolicy?.('old-assistant', 'message')).toBe(false)
  })

  test('uses the ordinary confirmation when deleting a filtered error message', () => {
    const failedReply = {
      ...message('failed-assistant', MessageRoleEnum.Assistant, 'failed answer'),
      error: 'request failed',
    }
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      settings: { agentMode: { value: 'on', locked: true, lockReason: null } },
      messages: [
        failedReply,
        message('current-user', MessageRoleEnum.User, 'current question'),
        message('current-assistant', MessageRoleEnum.Assistant, 'x'.repeat(4000)),
      ],
    }

    render(
      <MantineProvider>
        <MessageList currentSession={session} />
      </MantineProvider>
    )

    const resolveDeletePolicy = promptCacheDeleteResolversLog.at(-1)
    expect(resolveDeletePolicy?.(failedReply.id, 'message')).toBe(false)
  })

  test('keeps fork switchers reachable when their system-message pivot is hidden', () => {
    settingsState.hideSystemPromptMessage = true
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      messages: [
        message('system-message', MessageRoleEnum.System, 'system prompt'),
        message('assistant-message', MessageRoleEnum.Assistant, 'answer'),
      ],
      messageForksHash: {
        'system-message': {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'fork-a', messages: [] },
            { id: 'fork-b', messages: [] },
          ],
        },
      },
    }

    const { container } = render(
      <MantineProvider>
        <MessageList currentSession={session} />
      </MantineProvider>
    )

    expect(messageRenderLog).not.toContainEqual(expect.objectContaining({ id: 'system-message' }))
    expect(container.querySelector('[data-testid="fork-group-system-message"]')).not.toBeNull()
  })

  test('does not stretch an archived thread turn when the current new thread is appended after it', () => {
    const currentSystem = message('current-system', MessageRoleEnum.System, 'system')
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      messages: [currentSystem],
      threads: [
        {
          id: 'archived-thread',
          name: 'Archived Thread',
          createdAt: 1,
          messages: [
            message('old-user', MessageRoleEnum.User, 'old question'),
            message('old-assistant', MessageRoleEnum.Assistant, 'old answer'),
          ],
        },
      ],
    }
    const ref = createRef<MessageListRef>()

    const { container } = render(
      <MantineProvider>
        <MessageList ref={ref} currentSession={session} />
      </MantineProvider>
    )

    act(() => {
      ref.current?.setIsNewMessage(true)
    })

    expect(container.querySelector('[style*="min-height"]')).toBeNull()
  })
  test('only stretches the latest new message when the feature is enabled', () => {
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      messages: [message('user-message', MessageRoleEnum.User, 'question')],
    }
    const ref = createRef<MessageListRef>()

    const { container } = render(
      <MantineProvider>
        <MessageList ref={ref} currentSession={session} />
      </MantineProvider>
    )

    expect(container.querySelector('[style*="min-height"]')).toBeNull()

    act(() => {
      ref.current?.setIsNewMessage(true)
    })

    expect(container.querySelector<HTMLElement>('[style*="min-height"]')?.style.minHeight).toBe('510px')
  })

  test('scrolls to a summary through its rendered item index', () => {
    const summary = { ...message('summary-1', MessageRoleEnum.Assistant, 'summary'), isSummary: true }
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      messages: [
        message('user-1', MessageRoleEnum.User, 'first question'),
        message('assistant-1', MessageRoleEnum.Assistant, 'first answer'),
        summary,
        message('user-2', MessageRoleEnum.User, 'second question'),
        message('assistant-2', MessageRoleEnum.Assistant, 'second answer'),
      ],
    }
    const ref = createRef<MessageListRef>()

    render(
      <MantineProvider>
        <MessageList ref={ref} currentSession={session} />
      </MantineProvider>
    )

    let found = false
    act(() => {
      found = ref.current?.scrollToMessage('summary-1') ?? false
    })

    expect(found).toBe(true)
    expect(virtuosoScrollToIndexMock).toHaveBeenCalledWith({
      index: 2,
      align: 'center',
      behavior: 'smooth',
    })
  })

  test('renders a steered run in stored order: segment, steered user, continuation', () => {
    const session: Session = {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      messages: [
        message('user-1', MessageRoleEnum.User, 'start'),
        {
          ...message('assistant-1', MessageRoleEnum.Assistant, 'before steer'),
          finishReason: 'steered',
        },
        {
          ...message('steered-1', MessageRoleEnum.User, 'change direction'),
          steered: true,
        },
        {
          ...message('assistant-2', MessageRoleEnum.Assistant, 'after steer'),
          generating: true,
        },
      ],
    }

    render(
      <MantineProvider>
        <MessageList currentSession={session} />
      </MantineProvider>
    )

    // True-order persistence: the transcript renders as stored, every message
    // is durable, and ordinary message actions stay available on all of them.
    expect(messageRenderLog.slice(-4).map(({ id }) => id)).toEqual([
      'user-1',
      'assistant-1',
      'steered-1',
      'assistant-2',
    ])
    expect(messageButtonGroupLog).toContainEqual({ id: 'assistant-1', buttonGroup: 'auto' })
    expect(messageButtonGroupLog).toContainEqual({ id: 'assistant-2', buttonGroup: 'always' })
  })
})

describe('MessageList minimap anchors', () => {
  beforeEach(() => {
    minimapRenderLog.length = 0
    previewTextSpy.calls = 0
    isSmallScreenMock.value = false
  })

  function buildSession(assistantText: string, generating = false): Session {
    return {
      id: 'session-1',
      type: 'chat',
      name: 'Session',
      messages: [
        message('user-1', MessageRoleEnum.User, 'first question'),
        message('assistant-1', MessageRoleEnum.Assistant, 'first answer'),
        message('user-2', MessageRoleEnum.User, 'second question'),
        { ...message('assistant-2', MessageRoleEnum.Assistant, assistantText), generating },
      ],
    }
  }

  function updateAssistantMessage(session: Session, assistantText: string, generating: boolean): Session {
    return {
      ...session,
      messages: session.messages.map((currentMessage) =>
        currentMessage.id === 'assistant-2'
          ? {
              ...currentMessage,
              contentParts: [{ type: 'text', text: assistantText }],
              generating,
            }
          : currentMessage
      ),
    }
  }

  test('keeps the anchors reference stable across session cache replacements with identical previews', () => {
    // Unrelated session cache replacements must keep anchor identity once the
    // visible preview prefix is unchanged.
    const longReply = 'streamed reply '.repeat(40)
    const { rerender } = render(
      <MantineProvider>
        <MessageList currentSession={buildSession(longReply)} />
      </MantineProvider>
    )
    rerender(
      <MantineProvider>
        <MessageList currentSession={buildSession(`${longReply} more streamed tokens past the preview cutoff`)} />
      </MantineProvider>
    )

    expect(minimapRenderLog.length).toBeGreaterThanOrEqual(2)
    expect(minimapRenderLog.at(-1)).toBe(minimapRenderLog[0])
  })

  test('produces new anchors when a preview-visible text changes', () => {
    const { rerender } = render(
      <MantineProvider>
        <MessageList currentSession={buildSession('short answer')} />
      </MantineProvider>
    )
    rerender(
      <MantineProvider>
        <MessageList currentSession={buildSession('short answer grew')} />
      </MantineProvider>
    )

    expect(minimapRenderLog.length).toBeGreaterThanOrEqual(2)
    expect(minimapRenderLog.at(-1)).not.toBe(minimapRenderLog[0])
  })

  test('skips anchor computation entirely on small screens', () => {
    isSmallScreenMock.value = true

    const { rerender } = render(
      <MantineProvider>
        <MessageList currentSession={buildSession('short answer')} />
      </MantineProvider>
    )
    rerender(
      <MantineProvider>
        <MessageList currentSession={buildSession('short answer grew')} />
      </MantineProvider>
    )

    expect(previewTextSpy.calls).toBe(0)
    expect(minimapRenderLog.length).toBe(0)
  })

  test('freezes anchors across streaming chunks and loads the assistant preview after generation', () => {
    const initialSession = buildSession('partial reply', true)
    const { rerender } = render(
      <MantineProvider>
        <MessageList currentSession={initialSession} />
      </MantineProvider>
    )
    const generationStartAnchors = minimapRenderLog.at(-1) as Array<{ assistantText?: string }>
    const generationStartPreviewCalls = previewTextSpy.calls
    expect(generationStartAnchors.at(-1)?.assistantText).toBeUndefined()

    const nextChunkSession = updateAssistantMessage(initialSession, 'partial reply plus another chunk', true)
    rerender(
      <MantineProvider>
        <MessageList currentSession={nextChunkSession} />
      </MantineProvider>
    )
    expect(minimapRenderLog.at(-1)).toBe(generationStartAnchors)
    expect(previewTextSpy.calls).toBe(generationStartPreviewCalls)

    const completedSession = updateAssistantMessage(nextChunkSession, 'completed reply', false)
    rerender(
      <MantineProvider>
        <MessageList currentSession={completedSession} />
      </MantineProvider>
    )
    const completedAnchors = minimapRenderLog.at(-1) as Array<{ assistantText?: string }>
    expect(completedAnchors).not.toBe(generationStartAnchors)
    expect(completedAnchors.at(-1)?.assistantText).toBe('completed reply')
    expect(previewTextSpy.calls).toBeGreaterThan(generationStartPreviewCalls)
  })

  test('rebuilds once when steering inserts a user message during generation', () => {
    const initialSession = buildSession('partial reply', true)
    const { rerender } = render(
      <MantineProvider>
        <MessageList currentSession={initialSession} />
      </MantineProvider>
    )
    const generationStartAnchors = minimapRenderLog.at(-1) as Array<{ messageId: string }>

    const sessionWithSteering = {
      ...initialSession,
      messages: [...initialSession.messages, message('steered-user', MessageRoleEnum.User, 'change direction')],
    }
    rerender(
      <MantineProvider>
        <MessageList currentSession={sessionWithSteering} />
      </MantineProvider>
    )
    const steeredAnchors = minimapRenderLog.at(-1) as Array<{ messageId: string }>
    const steeredPreviewCalls = previewTextSpy.calls
    expect(steeredAnchors).not.toBe(generationStartAnchors)
    expect(steeredAnchors.at(-1)?.messageId).toBe('steered-user')

    const nextChunkWithSteering = updateAssistantMessage(sessionWithSteering, 'partial reply plus another chunk', true)
    rerender(
      <MantineProvider>
        <MessageList currentSession={nextChunkWithSteering} />
      </MantineProvider>
    )
    expect(minimapRenderLog.at(-1)).toBe(steeredAnchors)
    expect(previewTextSpy.calls).toBe(steeredPreviewCalls)
  })

  test('rebuilds anchors when a user message is edited during generation', () => {
    const initialSession = buildSession('partial reply', true)
    const { rerender } = render(
      <MantineProvider>
        <MessageList currentSession={initialSession} />
      </MantineProvider>
    )
    const generationStartAnchors = minimapRenderLog.at(-1) as Array<{ text: string }>
    const generationStartPreviewCalls = previewTextSpy.calls

    const editedSession: Session = {
      ...initialSession,
      messages: initialSession.messages.map((currentMessage) =>
        currentMessage.id === 'user-1'
          ? { ...currentMessage, contentParts: [{ type: 'text', text: 'edited first question' }] }
          : currentMessage
      ),
    }
    rerender(
      <MantineProvider>
        <MessageList currentSession={editedSession} />
      </MantineProvider>
    )
    const editedAnchors = minimapRenderLog.at(-1) as Array<{ text: string }>
    expect(editedAnchors).not.toBe(generationStartAnchors)
    expect(editedAnchors[0]?.text).toBe('edited first question')
    expect(previewTextSpy.calls).toBeGreaterThan(generationStartPreviewCalls)

    const nextChunkSession = updateAssistantMessage(editedSession, 'partial reply plus another chunk', true)
    const editedPreviewCalls = previewTextSpy.calls
    rerender(
      <MantineProvider>
        <MessageList currentSession={nextChunkSession} />
      </MantineProvider>
    )
    expect(minimapRenderLog.at(-1)).toBe(editedAnchors)
    expect(previewTextSpy.calls).toBe(editedPreviewCalls)
  })
})
