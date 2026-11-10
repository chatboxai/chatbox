// @vitest-environment jsdom
import type {
  SessionCommandDelta,
  SessionHeaderRead,
  SessionTranscriptPage,
  SessionTranscriptRequest,
} from '@chatbox/core/ports'
import { useSessionTranscript } from '@chatbox/react/query'
import { MantineProvider } from '@mantine/core'
import type { Message as Body } from '@shared/types'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import { createRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { platformTypeAtom } from '@/hooks/useNeedRoomForWinControls'
import type { TranscriptNavigation } from '@/stores/uiStore'
import MessageList, { type MessageListRef } from './MessageList'
import type { MessageMinimapRailProps } from './MessageMinimapRail'

const h = vi.hoisted(() => ({
  read: vi.fn(),
  controller: null as import('@chatbox/react/query').SessionTranscriptWindowController | null,
  registerWindow: vi.fn(() => vi.fn()),
  scrollTo: vi.fn(),
  scrollToIndex: vi.fn(),
  scrollIntoView: vi.fn(),
  scrollBy: vi.fn(),
  navigation: null as TranscriptNavigation | null,
  firstReady: false,
  measuredHeight: 1000,
  currentScroller: null as HTMLDivElement | null,
  itemsRendered: null as ((items: Array<{ size: number }>) => void) | null,
  initialLocations: [] as unknown[],
  hideSystem: false,
  threadCount: 1,
  emptyThreadCount: 0,
  activeThreadEmpty: false,
  moreThreadPages: false,
  agentMode: 'off' as 'off' | 'on',
  renderMenu: vi.fn(),
  smallScreen: false,
  platformType: 'desktop' as 'desktop' | 'mobile',
  activity: 'idle' as 'idle' | 'generating',
  atTop: null as ((value: boolean) => void) | null,
  atBottom: null as ((value: boolean) => void) | null,
  isScrolling: null as ((value: boolean) => void) | null,
  followOutput: false as false | 'auto' | 'smooth' | ((atBottom: boolean) => false | 'auto' | 'smooth'),
  scrollIntoViewOnChange: undefined as
    | undefined
    | ((params: { totalCount: number }) => import('react-virtuoso').FlatScrollIntoViewLocation),
  acknowledgeMeasurements: true,
  starts: [] as Array<() => void>,
  minimapProps: null as MessageMinimapRailProps | null,
  bodyModes: [] as Array<{ id: string; readOnly: boolean | undefined }>,
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { readSessionTranscriptWindow: h.read, shouldConfirmPromptCacheDelete: vi.fn(async () => false) },
    sessionQueryBridge: { registerWindow: h.registerWindow },
    sessionHooks: {
      useSessionThreads: () => ({
        threads: [
          ...Array.from({ length: h.threadCount }, (_, index) => ({
            threadId: `thread-${index}`,
            rootMessageId: `root-${index}`,
            threadOrder: index,
          })),
          ...Array.from({ length: h.emptyThreadCount }, (_, index) => ({
            threadId: `empty-${index}`,
            rootMessageId: null,
            threadOrder: h.threadCount + index,
          })),
          ...(h.activeThreadEmpty ? [{ threadId: 'active-empty', rootMessageId: null, threadOrder: -1 }] : []),
        ],
        hasNextPage: h.moreThreadPages,
      }),
    },
  },
}))
vi.mock('@/hooks/useSessionLockState', () => ({
  useSessionControls: () => ({
    locks: {
      generatingReplyCount: 0,
      anyReplyGenerating: false,
      awaitingPauseDecision: false,
      compactionRunning: false,
    },
    data: { cancellableMessages: [] },
  }),
}))
vi.mock('@/stores/session/agent-mode', () => ({ useSessionAgentMode: () => ({ value: h.agentMode }) }))
vi.mock('@/hooks/useCopilots', () => ({ useMyCopilots: () => ({ copilots: [] }) }))
vi.mock('@/lib/utils', () => ({ cn: (...items: unknown[]) => items.filter(Boolean).join(' ') }))
vi.mock('@/platform', () => ({
  default: {
    get type() {
      return h.platformType
    },
  },
}))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => h.smallScreen }))
vi.mock('@/stores/sessionActivityStore', () => ({ useSessionActivity: () => h.activity }))
vi.mock('@/hooks/useNeedRoomForWinControls', async () => {
  const { atom } = await import('jotai')
  return { platformTypeAtom: atom('win32') }
})
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ autoCollapseCodeBlock: false }) },
  useSettingsStore: (
    selector: (value: { hideSystemPromptMessage: boolean; maxContextMessageCount: number }) => unknown
  ) => selector({ hideSystemPromptMessage: h.hideSystem, maxContextMessageCount: 20 }),
}))
vi.mock('@/stores/uiStore', () => {
  const state = {
    widthFull: true,
    setMessageListElement: vi.fn(),
    setMessageScrollingAtBottom: vi.fn(),
    setMessageScrollingAtTop: vi.fn(),
    get transcriptNavigation() {
      return h.navigation
    },
    setTranscriptNavigation(value: TranscriptNavigation | null) {
      h.navigation = value
    },
    openSessionPanel: vi.fn(),
  }
  return {
    uiStore: { getState: () => state },
    useUIStore: (selector: (value: typeof state) => unknown) => selector(state),
  }
})
vi.mock('@/stores/session/messages', () => ({ removeMessage: vi.fn() }))
vi.mock('@/stores/session/threads', () => ({
  removeThread: vi.fn(),
  switchThread: vi.fn(),
  moveThreadToConversations: vi.fn(),
}))
vi.mock('@/utils/session-lock-copy', () => ({ notifySessionLockBlocked: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../Markdown', () => ({ BlockCodeCollapsedStateProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('../ActionMenu', () => ({
  default: ({ children, items }: { children: ReactNode; items: Array<{ text?: string }> }) => {
    h.renderMenu(items)
    return children
  },
}))
vi.mock('../common/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: ReactNode }) => children }))
vi.mock('./Message', () => ({
  default: ({ msg, readOnly, forkSwitcher }: { msg: Body; readOnly?: boolean; forkSwitcher?: ReactNode }) => {
    h.bodyModes.push({ id: msg.id, readOnly })
    return (
      <div data-testid={`message-${msg.id}`}>
        {forkSwitcher}
        {msg.role}
      </div>
    )
  },
}))
vi.mock('./SummaryMessage', () => ({ default: ({ msg }: { msg: Body }) => <div>{msg.id}</div> }))
vi.mock('./ForkMarkerMessage', () => ({ default: () => null }))
vi.mock('./ForkGroup', () => ({
  default: ({
    msgId,
    headRole,
    children,
  }: {
    msgId: string
    headRole?: string
    children?: (forkControls: ReactNode) => ReactNode
  }) => {
    const controls = <div data-testid={`fork-${msgId}`} data-head-role={headRole} />
    return children ? children(controls) : controls
  },
}))
vi.mock('./MessageMinimapRail', () => ({
  default: (props: MessageMinimapRailProps) => {
    h.minimapProps = props
    return (
      <button data-testid="minimap" onClick={() => props.anchors[0] && props.onJump?.(props.anchors[0])}>
        Jump to message
      </button>
    )
  },
}))
vi.mock('./MessageNavigation', () => ({
  FLOATING_BUTTON_GLASS_PROPS: { className: 'chatbox-glass-surface', style: {} },
  default: ({
    onScrollToBottom,
    onScrollToPrev,
    onScrollToNext,
  }: {
    onScrollToBottom(): void
    onScrollToPrev(): void
    onScrollToNext(): void
  }) => (
    <>
      <button data-testid="desktop-navigation" onClick={onScrollToBottom}>
        Desktop tail
      </button>
      <button onClick={onScrollToPrev}>Previous message</button>
      <button onClick={onScrollToNext}>Next message</button>
    </>
  ),
  ScrollToBottomButton: ({ onClick }: { onClick(): void }) => (
    <button data-testid="mobile-tail" onClick={onClick}>
      Mobile tail
    </button>
  ),
}))
vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return {
    Virtuoso: React.forwardRef(
      (
        props: {
          data: Array<{ key: string }>
          itemContent(index: number, item: unknown): ReactNode
          firstItemIndex: number
          initialTopMostItemIndex: unknown
          scrollerRef(element: HTMLElement | null): void
          itemsRendered(items: Array<{ size: number }>): void
          followOutput: typeof h.followOutput
          scrollIntoViewOnChange: typeof h.scrollIntoViewOnChange
          startReached(): void
          onScroll(): void
          atTopStateChange(value: boolean): void
          atBottomStateChange(value: boolean): void
          isScrolling(value: boolean): void
          style?: React.CSSProperties
          className?: string
          components?: Record<'Header' | 'Footer', React.ComponentType<{ context: unknown }>>
          context?: unknown
        },
        ref
      ) => {
        const element = React.useRef<HTMLDivElement>(null)
        React.useImperativeHandle(ref, () => ({
          scrollTo: h.scrollTo,
          scrollToIndex: h.scrollToIndex,
          scrollIntoView: h.scrollIntoView,
          scrollBy: h.scrollBy,
        }))
        React.useLayoutEffect(() => {
          h.currentScroller = element.current
          if (element.current) {
            Object.defineProperties(element.current, {
              clientHeight: { value: 600, configurable: true },
              scrollHeight: { get: () => h.measuredHeight, configurable: true },
            })
          }
          h.initialLocations.push(props.initialTopMostItemIndex)
          const location = props.initialTopMostItemIndex as { index: number | 'LAST' }
          if (element.current && location.index === 'LAST') element.current.scrollTop = h.measuredHeight - 600
          props.atBottomStateChange(location.index === 'LAST')
        }, [])
        // Virtuoso reports its scroller from a passive effect, after the host's layout effects,
        // and reports no rendered range for empty data.
        React.useEffect(() => {
          props.scrollerRef(element.current)
          if (h.acknowledgeMeasurements && props.data.length) props.itemsRendered([{ size: 20 }])
          return () => props.scrollerRef(null)
        }, [props])
        h.itemsRendered = props.itemsRendered
        h.atTop = props.atTopStateChange
        h.atBottom = props.atBottomStateChange
        h.isScrolling = props.isScrolling
        h.followOutput = props.followOutput
        h.scrollIntoViewOnChange = props.scrollIntoViewOnChange
        h.starts.push(props.startReached)
        return (
          <div
            ref={element}
            style={props.style}
            className={props.className}
            data-testid="virtuoso"
            data-first-index={props.firstItemIndex}
            data-follow-output={String(
              typeof props.followOutput === 'function' ? props.followOutput(false) : props.followOutput
            )}
            onScroll={props.onScroll}
          >
            {props.components && <props.components.Header context={props.context} />}
            {props.data.map((item, index) => (
              <div key={item.key}>{props.itemContent(props.firstItemIndex + index, item)}</div>
            ))}
            {props.components && <props.components.Footer context={props.context} />}
          </div>
        )
      }
    ),
  }
})

const header: SessionHeaderRead = {
  header: { id: 's', name: 'Chat', type: 'chat' },
  revision: 1,
  activeThreadId: 't',
  control: { generatingAssistantCount: 0 },
  summary: {
    hasAutoTitleContent: false,
    messageCount: 220,
    userMessageCount: 110,
    assistantMessageCount: 110,
    fileMessageCount: 0,
    generatingMessageCount: 0,
    pausedMessageCount: 0,
    webSearchSignInErrorCount: 0,
    legacyCommandMessageCount: 0,
    steeredMessageCount: 0,
  },
}
function page(request: SessionTranscriptRequest): SessionTranscriptPage {
  const size = request.limit
  const target =
    typeof request.origin === 'object' && 'messageId' in request.origin
      ? Number(request.origin.messageId.slice(1))
      : undefined
  const first = request.cursor
    ? request.cursor.direction === 'before'
      ? Math.max(0, Number(request.cursor.messageId?.slice(1)) - size)
      : Number(request.cursor.messageId?.slice(1)) + 1
    : request.origin === 'head'
      ? 0
      : target !== undefined
        ? typeof request.origin === 'object' && request.origin.align === 'center'
          ? Math.max(0, Math.min(220 - size, target - Math.floor((size - 1) / 2)))
          : target
        : 220 - size
  const end =
    request.cursor?.direction === 'before' ? Number(request.cursor.messageId?.slice(1)) : Math.min(first + size, 220)
  const messages = Array.from({ length: end - first }, (_, index) => {
    const siblingOrder = first + index
    return {
      sessionId: 's',
      threadId: 't',
      messageId: `m${siblingOrder}`,
      siblingOrder,
      parentMessageId: siblingOrder ? `m${siblingOrder - 1}` : null,
      activeChildId: siblingOrder < 219 ? `m${siblingOrder + 1}` : null,
      kind: 'message' as const,
      status: 'settled' as const,
      createdAt: 1,
      updatedAt: 1,
      branchId: null,
      message: {
        id: `m${siblingOrder}`,
        role: siblingOrder % 2 ? ('assistant' as const) : ('user' as const),
        contentParts: [],
      },
    }
  })
  const cursor = (messageId: string, direction: 'before' | 'after') => ({
    sessionId: 's',
    threadId: 't',
    threadOrder: -1,
    revision: 1,
    limit: size,
    maxBytes: 2 * 1024 * 1024,
    scope: 'transcript' as const,
    messageId,
    direction,
  })
  return {
    record: { id: 's', name: 'Chat', storageFormat: 'rows', activeThreadId: 't' },
    revision: 1,
    threads: [
      {
        sessionId: 's',
        threadId: 't',
        threadOrder: -1,
        name: 'Current',
        createdAt: 1,
        rootMessageId: 'm0',
        activeLeafMessageId: 'm219',
      },
    ],
    messages,
    payloadBytes: 100,
    anchor: { threadId: 't', messageId: target === undefined ? (messages[0]?.messageId ?? null) : `m${target}` },
    older: first ? cursor(`m${first}`, 'before') : null,
    newer: end < 220 ? cursor(`m${end - 1}`, 'after') : null,
  }
}
const source = {
  readSessionTranscriptWindow: (request: SessionTranscriptRequest) => h.read(request) as Promise<SessionTranscriptPage>,
}
const bridge = { registerWindow: h.registerWindow } as unknown as Parameters<typeof useSessionTranscript>[0]['bridge']
function Host({
  listRef,
  search,
  read = header,
  readSource = source,
}: {
  listRef?: React.Ref<MessageListRef>
  search?: string
  read?: SessionHeaderRead
  readSource?: typeof source
}) {
  const transcript = useSessionTranscript({
    sessionId: 's',
    platform: 'web',
    source: readSource,
    bridge,
    initialOrigin: search ? { messageId: search } : 'tail',
  })
  h.controller = transcript.controller
  h.firstReady = transcript.firstWindowReady
  return (
    <MantineProvider>
      <MessageList ref={listRef} headerRead={read} transcript={transcript} />
    </MantineProvider>
  )
}
beforeEach(() => {
  h.read.mockReset().mockImplementation(async (request) => page(request))
  h.navigation = null
  h.firstReady = false
  h.measuredHeight = 1000
  h.currentScroller = null
  h.itemsRendered = null
  h.initialLocations.length = 0
  h.hideSystem = false
  h.threadCount = 1
  h.emptyThreadCount = 0
  h.activeThreadEmpty = false
  h.moreThreadPages = false
  h.agentMode = 'off'
  h.renderMenu.mockClear()
  h.smallScreen = false
  h.platformType = 'desktop'
  getDefaultStore().set(platformTypeAtom, 'win32')
  h.activity = 'idle'
  h.atTop = null
  h.atBottom = null
  h.isScrolling = null
  h.followOutput = false
  h.scrollIntoViewOnChange = undefined
  h.acknowledgeMeasurements = true
  h.starts.length = 0
  h.minimapProps = null
  h.bodyModes.length = 0
  h.scrollTo.mockReset().mockImplementation(({ top }: { top: number }) => {
    if (h.currentScroller) h.currentScroller.scrollTop = top
  })
  h.scrollBy.mockReset()
  h.scrollIntoView.mockReset()
  h.scrollToIndex.mockReset().mockImplementation(() => {
    if (h.currentScroller) h.currentScroller.scrollTop = Math.max(0, h.measuredHeight - 600)
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0)
  )
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('row transcript host', () => {
  test.each(['off', 'on'] as const)('hides the sole thread heading and menu in agent mode %s', async (mode) => {
    h.agentMode = mode
    const view = render(<Host search="m0" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(view.queryByText('Current')).toBeNull()
    expect(h.renderMenu).not.toHaveBeenCalled()
    expect(view.getByTestId('message-m1')).toBeTruthy()
  })
  test.each(['off', 'on'] as const)('hides a sole empty thread heading in agent mode %s', async (mode) => {
    h.agentMode = mode
    h.read.mockImplementation(async (request: SessionTranscriptRequest) => {
      const result = page(request)
      result.messages = []
      result.threads[0].rootMessageId = null
      result.threads[0].activeLeafMessageId = null
      result.older = null
      result.newer = null
      return result
    })
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(view.queryByText('Current')).toBeNull()
    expect(h.renderMenu).not.toHaveBeenCalled()
  })
  test('finishes opening an empty conversation once the list attaches its scroller', async () => {
    h.read.mockImplementation(async (request: SessionTranscriptRequest) => ({
      ...page(request),
      messages: [],
      older: null,
      newer: null,
    }))
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(h.controller?.getSnapshot().layout).toBeNull()
    expect(view.getByTestId('session-transcript').getAttribute('aria-busy')).toBe('false')
    expect(getComputedStyle(view.getByTestId('virtuoso')).visibility).toBe('visible')
  })
  test.each(['off', 'on'] as const)(
    'shows multi-thread headings when only one thread is loaded in mode %s',
    async (mode) => {
      h.agentMode = mode
      h.threadCount = 2
      const view = render(<Host search="m0" />)
      await waitFor(() => expect(h.firstReady).toBe(true))
      expect(h.controller?.getSnapshot().threads).toHaveLength(1)
      expect(view.getAllByText('Current')).toHaveLength(1)
      const actions = h.renderMenu.mock.calls
        .at(-1)?.[0]
        .flatMap((item: { text?: string }) => (item.text ? [item.text] : []))
      expect(actions).toEqual(
        mode === 'on'
          ? ['Edit Thread Name', 'Show in Thread List']
          : ['Edit Thread Name', 'Show in Thread List', 'Continue this thread', 'Move to Conversations', 'delete']
      )
    }
  )
  test('hides the sole thread heading when the other thread rows are empty', async () => {
    h.emptyThreadCount = 2
    const view = render(<Host search="m0" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(view.queryByText('Current')).toBeNull()
    expect(h.renderMenu).not.toHaveBeenCalled()
    expect(view.getByTestId('message-m1')).toBeTruthy()
  })
  test('keeps headings when empty rows fill a summary page that has more pages', async () => {
    h.emptyThreadCount = 49
    h.moreThreadPages = true
    const view = render(<Host search="m0" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(view.getAllByText('Current')).toHaveLength(1)
    h.moreThreadPages = false
    view.rerender(<Host search="m0" />)
    expect(view.queryByText('Current')).toBeNull()
  })
  test('shows archived thread headings next to an empty active thread', async () => {
    h.activeThreadEmpty = true
    const view = render(<Host search="m0" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(view.getAllByText('Current')).toHaveLength(1)
  })
  test('updates heading visibility when thread metadata changes without rereading message bodies', async () => {
    const view = render(<Host search="m0" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(view.queryByText('Current')).toBeNull()
    h.threadCount = 2
    view.rerender(<Host search="m0" />)
    expect(view.getByText('Current')).toBeTruthy()
    h.threadCount = 1
    view.rerender(<Host search="m0" />)
    expect(view.queryByText('Current')).toBeNull()
    expect(view.getByTestId('message-m1')).toBeTruthy()
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  test.each([false, true])('uses the existing navigation controls on smallScreen=%s', async (smallScreen) => {
    h.smallScreen = smallScreen
    const view = render(<Host search="m0" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(view.queryByTestId('desktop-navigation') !== null).toBe(!smallScreen)
    expect(view.queryByTestId('mobile-tail') !== null).toBe(smallScreen)
    expect(view.queryByRole('button', { name: 'Generating...' })).toBeNull()
    expect(view.getByTestId('virtuoso').style.scrollbarGutter).toBe(smallScreen ? 'auto' : 'stable both-edges')
    expect(view.getByTestId('virtuoso').classList.contains('scrollbar-custom')).toBe(true)
    fireEvent.click(view.getByTestId(smallScreen ? 'mobile-tail' : 'desktop-navigation'))
    await waitFor(() => expect(h.controller?.getSnapshot().rows.at(-1)?.messageId).toBe('m219'))
    expect(h.read.mock.calls.at(-1)?.[0]).toMatchObject({ origin: 'tail', limit: 100 })
  })
  test.each([false, true])('shows the generating return-to-tail control on smallScreen=%s', async (smallScreen) => {
    h.smallScreen = smallScreen
    h.activity = 'generating'
    const view = render(<Host search="m0" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(view.queryByTestId('desktop-navigation') !== null).toBe(!smallScreen)
    expect(view.queryByTestId('mobile-tail')).toBeNull()
    act(() => h.atBottom?.(true))
    expect(view.getByRole('status').textContent).toBe('Loading...')
    fireEvent.click(view.getByRole('button', { name: 'Generating...' }))
    await waitFor(() => expect(h.controller?.getSnapshot().rows.at(-1)?.messageId).toBe('m219'))
    act(() => h.atBottom?.(true))
    expect(view.queryByRole('button', { name: 'Generating...' })).toBeNull()
  })
  test.each([
    { search: undefined, older: true, newer: false },
    { search: 'm0', older: false, newer: true },
    { search: 'm60', older: true, newer: true },
  ])('shows pending pages at their list edges for search=$search', async ({ search, older, newer }) => {
    const view = render(<Host search={search} />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const list = view.getByTestId('virtuoso')
    const statuses = within(list).getAllByRole('status')
    expect(statuses).toHaveLength(Number(older) + Number(newer))
    expect(statuses.every((status) => status.textContent === 'Loading...')).toBe(true)
    expect(statuses.some((status) => list.firstElementChild?.contains(status))).toBe(older)
    expect(statuses.some((status) => list.lastElementChild?.contains(status))).toBe(newer)
    expect(h.controller!.getSnapshot().operation).toBeNull()
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  test('removes each pending-page indicator when that end of the conversation is reached', async () => {
    const view = render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const list = view.getByTestId('virtuoso')
    expect(within(list).getAllByRole('status')).toHaveLength(2)
    const olderEdge = list.firstElementChild
    const newerEdge = list.lastElementChild
    await act(async () => {
      await h.controller!.loadOlder()
    })
    expect(h.controller!.getSnapshot().hasOlder).toBe(false)
    expect(list.firstElementChild).toBe(olderEdge)
    expect(within(list).getAllByRole('status')).toHaveLength(1)
    expect(list.lastElementChild?.contains(within(list).getByRole('status'))).toBe(true)
    await act(async () => {
      await h.controller!.loadNewer()
    })
    expect(h.controller!.getSnapshot().hasNewer).toBe(true)
    expect(within(list).getByRole('status').textContent).toBe('Loading...')
    await act(async () => {
      await h.controller!.loadNewer()
    })
    expect(h.controller!.getSnapshot().hasNewer).toBe(false)
    expect(within(list).queryByRole('status')).toBeNull()
    expect(list.lastElementChild).toBe(newerEdge)
  })

  test('keeps mobile navigation clear of the pending history indicator at the loaded top', async () => {
    h.smallScreen = true
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    viewport.scrollTop = 350
    fireEvent.scroll(viewport)
    viewport.scrollTop = 250
    fireEvent.scroll(viewport)
    await waitFor(() => expect(view.getByRole('button', { name: 'Return to the top' })).toBeTruthy())
    act(() => h.atTop?.(true))
    await waitFor(() => expect(view.queryByRole('button', { name: 'Return to the top' })).toBeNull())
    expect(h.controller!.getSnapshot().hasOlder).toBe(true)
    expect(view.getByRole('status').textContent).toBe('Loading...')
    act(() => h.atTop?.(false))
    await waitFor(() => expect(view.getByRole('button', { name: 'Return to the top' })).toBeTruthy())
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  test('reports a failed older page as the first list row', async () => {
    const view = render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    h.read.mockRejectedValueOnce(new Error('Page read failed'))
    await act(async () => {
      await h.controller?.loadOlder()
    })
    const notice = view.getByRole('alert')
    expect(notice.textContent).toContain('Earlier messages could not be loaded')
    expect(notice.textContent).toContain('Page read failed')
    const list = view.getByTestId('virtuoso')
    expect(list.firstElementChild?.contains(notice)).toBe(true)
    expect(list.firstElementChild?.querySelector('[role="status"]')).toBeNull()
    expect(list.lastElementChild?.contains(view.getByRole('status'))).toBe(true)
    expect(view.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Try Again' }))
    expect(view.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(h.read).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(view.getByTestId('session-transcript').dataset.transcriptFirstMessageId).toBe('m0'))
    expect(view.queryByRole('alert')).toBeNull()
    expect(list.lastElementChild?.contains(view.getByRole('status'))).toBe(true)
  })

  test('reports a failed newer page as the last list row', async () => {
    const view = render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    h.read.mockRejectedValueOnce(new Error('Page read failed'))
    await act(async () => {
      await h.controller?.loadNewer()
    })
    const notice = view.getByRole('alert')
    expect(notice.textContent).toContain('Later messages could not be loaded')
    const list = view.getByTestId('virtuoso')
    expect(list.lastElementChild?.contains(notice)).toBe(true)
    expect(list.lastElementChild?.querySelector('[role="status"]')).toBeNull()
    expect(list.firstElementChild?.contains(view.getByRole('status'))).toBe(true)
    expect(view.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Try Again' }))
    await waitFor(() => expect(h.controller!.getSnapshot().operation).toBeNull())
    expect(h.controller!.getSnapshot().hasNewer).toBe(true)
    expect(view.queryByRole('alert')).toBeNull()
    expect(within(list).getAllByRole('status')).toHaveLength(2)
  })

  test('reports a failed navigation above the list until a retry succeeds', async () => {
    const view = render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    h.read.mockRejectedValueOnce(new Error('Window read failed'))
    await act(async () => {
      await h.controller?.navigate({ messageId: 'm200' })
    })
    const notice = view.getByRole('alert')
    expect(notice.textContent).toContain('Some messages could not be loaded')
    expect(view.getByTestId('session-transcript').contains(notice)).toBe(false)
    expect(view.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Try Again' }))
    await waitFor(() => expect(view.getByTestId('session-transcript').dataset.transcriptFirstMessageId).not.toBe('m60'))
    expect(view.queryByRole('alert')).toBeNull()
  })

  test('shows a conversation that failed to open as the empty state with only a retry', async () => {
    h.read.mockRejectedValue(new Error('Storage unavailable'))
    const view = render(<Host />)
    await waitFor(() => expect(view.getByText('This conversation could not be loaded')).toBeTruthy())
    expect(view.getByRole('alert').textContent).toContain('Storage unavailable')
    expect(view.getByTestId('session-transcript').contains(view.getByRole('alert'))).toBe(true)
    expect(view.getByRole('button', { name: 'Try Again' })).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })

  test('preserves user and final-turn spacing', async () => {
    h.read.mockImplementation(async (request: SessionTranscriptRequest) => {
      const result = page(request)
      result.threads[0].summary = { ...header.summary, lastUserMessageId: 'm218' }
      return result
    })
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const user = view.container.querySelector<HTMLElement>('[data-transcript-message="m218"]')!
    const assistant = view.container.querySelector<HTMLElement>('[data-transcript-message="m219"]')!
    expect(user.style.paddingTop).toBe('calc(0.25rem * var(--mantine-scale))')
    expect(assistant.style.paddingTop).toBe('0rem')
    expect(user.parentElement?.classList.contains('pt-5')).toBe(true)
  })
  function withForks(
    forks: Array<{ pivot: string; branchPoint?: string; head?: string | null }>
  ): (request: SessionTranscriptRequest) => Promise<SessionTranscriptPage> {
    return async (request) => {
      const result = page(request)
      result.messages = result.messages.map((row) => {
        const asPivot = forks.find((fork) => fork.pivot === row.messageId)
        const asBranchPoint = forks.find((fork) => (fork.branchPoint ?? fork.pivot) === row.messageId)
        return {
          ...row,
          ...(asBranchPoint && asBranchPoint.head !== undefined ? { activeChildId: asBranchPoint.head } : {}),
          ...(asPivot
            ? {
                fork: {
                  pivotId: asPivot.pivot,
                  branchPointId: asPivot.branchPoint ?? asPivot.pivot,
                  selectedBranchId: 'selected',
                  count: 2,
                  position: 1,
                },
              }
            : {}),
        }
      })
      return result
    }
  }
  test.each([
    ['the selected branch is empty', null],
    ['the head is outside the loaded window', 'm999'],
  ])('keeps the switcher under the pivot when %s', async (_name, head) => {
    h.read.mockImplementation(withForks([{ pivot: 'm219', head }]))
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const switcher = view.getByTestId('fork-m219')
    expect(switcher.closest('[data-testid^="message-"]')).toBeNull()
    expect(switcher.closest('[data-transcript-message]')?.getAttribute('data-transcript-message')).toBe('m219')
  })
  test.each([false, true])('shows historical thread dates with an empty thread=%s', async (empty) => {
    h.threadCount = 2
    h.read.mockImplementation(async (request: SessionTranscriptRequest) => {
      const result = page(request)
      result.threads[0] = { ...result.threads[0], threadOrder: 0, name: 'History', createdAt: 1_700_000_000_000 }
      if (empty) {
        result.messages = []
        result.threads[0].rootMessageId = null
        result.threads[0].activeLeafMessageId = null
        result.older = null
        result.newer = null
      }
      return result
    })
    const view = render(<Host search="m0" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(view.getByText('History')).toBeTruthy()
    expect(view.getByText(new Date(1_700_000_000_000).toLocaleString())).toBeTruthy()
    expect(h.read).toHaveBeenCalledTimes(1)
  })
  test('renders the minimap from the loaded tail page after layout', async () => {
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.read.mock.calls[0][0]).toMatchObject({ origin: 'tail', limit: 100 })
    expect(h.controller!.getSnapshot().rows).toHaveLength(100)
    expect(h.minimapProps!.anchors).toHaveLength(50)
    expect(view.getByTestId('virtuoso').dataset.firstIndex).toBe('1000000')
    expect(getComputedStyle(view.getByTestId('virtuoso')).visibility).toBe('visible')
    expect(view.queryByTestId('message-m119')).toBeNull()
    expect(view.getByTestId('message-m120')).toBeTruthy()
    expect(view.queryByText('Current')).toBeNull()
    expect(h.minimapProps!.anchors.map((anchor) => anchor.messageId)).toEqual(
      h
        .controller!.getSnapshot()
        .rows.filter((row) => row.message.role === 'user')
        .map((row) => row.messageId)
    )
  })
  test.each([
    { role: 'user' as const, hideSystem: false },
    { role: 'system' as const, hideSystem: false },
    { role: 'system' as const, hideSystem: true },
  ])('retains the first thread title for a $role root with hideSystem=$hideSystem', async ({ role, hideSystem }) => {
    h.hideSystem = hideSystem
    h.threadCount = 2
    h.read.mockImplementation(async (request: SessionTranscriptRequest) => {
      const result = page(request)
      result.messages[0].message.role = role
      return result
    })
    const view = render(<Host search="m0" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const root = view.container.querySelector('[data-transcript-message="m0"]')
    expect(view.getAllByText('Current')).toHaveLength(1)
    expect(root?.contains(view.getByText('Current'))).toBe(true)
    expect(view.queryByTestId('message-m0') !== null).toBe(!hideSystem)
    expect(view.getByTestId('message-m1')).toBeTruthy()
    expect(h.read).toHaveBeenCalledTimes(1)
  })
})

describe('send follow intent', () => {
  async function openAtTail() {
    const listRef = createRef<MessageListRef>()
    const view = render(<Host listRef={listRef} />)
    await waitFor(() => {
      expect(h.firstReady).toBe(true)
      expect(h.controller!.getSnapshot().layout).toBeNull()
    })
    const viewport = view.getByTestId('virtuoso')
    expect(viewport.scrollTop).toBe(400)
    return { listRef, view, viewport }
  }
  async function openReadingHistory() {
    const listRef = createRef<MessageListRef>()
    const view = render(<Host listRef={listRef} search="m0" />)
    await waitFor(() => {
      expect(h.firstReady).toBe(true)
      expect(h.controller!.getSnapshot().layout).toBeNull()
    })
    expect(h.controller!.getSnapshot().hasNewer).toBe(true)
    return { listRef, view, viewport: view.getByTestId('virtuoso') }
  }

  function beginBranch(messageCount: number, onBegin?: () => void, branchMode: 'create' | 'select' = 'select') {
    const controller = h.controller!
    const state = controller.getSnapshot()
    const revision = state.revision! + 1
    const base = state.pages[0]
    const pivot = state.rows.find((row) => row.messageId === 'm218')!
    const messages = Array.from({ length: messageCount }, (_, index) => {
      const messageId = `branch-${revision}-${index}`
      return {
        ...pivot,
        messageId,
        siblingOrder: index,
        parentMessageId: index ? `branch-${revision}-${index - 1}` : pivot.messageId,
        activeChildId: index < messageCount - 1 ? `branch-${revision}-${index + 1}` : null,
        message: { id: messageId, role: index % 2 ? ('user' as const) : ('assistant' as const), contentParts: [] },
      }
    })
    let resolve!: (page: SessionTranscriptPage) => void
    h.read.mockImplementationOnce(
      () =>
        new Promise<SessionTranscriptPage>((finish) => {
          resolve = finish
        })
    )
    let pending!: Promise<boolean>
    act(() => {
      pending = controller.applyBranchCommit({
        record: base.record,
        previousRevision: state.revision!,
        revision,
        branchMode,
        sharedPrefixEnd: { threadId: 't', messageId: pivot.messageId },
        origin: { messageId: messages[0].messageId },
      })
      onBegin?.()
    })
    return async () => {
      await act(async () => {
        resolve({
          ...base,
          revision,
          messages,
          threads: base.threads.map((thread) => ({ ...thread, activeLeafMessageId: messages.at(-1)!.messageId })),
          payloadBytes: 100,
          anchor: { threadId: 't', messageId: messages[0].messageId },
          older: null,
          newer: null,
        })
        await pending
      })
      await waitFor(() => expect(controller.getSnapshot().operation).toBeNull())
    }
  }

  async function createBranch(pivotId = 'm218', messageCount = 1) {
    const controller = h.controller!
    const state = controller.getSnapshot()
    const pivot = state.rows.find((row) => row.messageId === pivotId)!
    const revision = state.revision! + 1
    const messages = Array.from({ length: messageCount }, (_, index) => ({
      ...pivot,
      messageId: `created-${revision}-${index}`,
      parentMessageId: index ? `created-${revision}-${index - 1}` : pivotId,
      activeChildId: index < messageCount - 1 ? `created-${revision}-${index + 1}` : null,
      message: {
        id: `created-${revision}-${index}`,
        role: index === messageCount - 1 ? ('assistant' as const) : ('user' as const),
        contentParts: [],
        generating: index === messageCount - 1,
      },
    }))
    const { message: _message, ...metadata } = pivot
    const change: SessionCommandDelta = {
      sessionId: 's',
      record: state.pages[0].record,
      header: header.header,
      previousRevision: state.revision!,
      revision,
      appendedMessageIds: messages.map((row) => row.messageId),
      structureResult: {
        applied: true,
        cancelMessageIds: [],
        navigation: {
          type: 'branch',
          mode: 'create',
          sharedPrefixEnd: { threadId: pivot.threadId, messageId: pivotId },
          firstMessageId: messages[0].messageId,
        },
      },
      diff: {
        sessionId: 's',
        messages: { upsert: messages, delete: [] },
        messageMetadataUpsert: [{ ...metadata, activeChildId: messages[0].messageId }],
        threads: {
          upsert: state.threads.map((thread) => ({
            ...thread,
            compactionPoints: [],
            activeLeafMessageId: messages.at(-1)!.messageId,
          })),
          delete: [],
        },
      },
    }
    act(() => expect(controller.applyCreatedBranch(change, true)).toBe(true))
    await waitFor(() => expect(controller.getSnapshot().operation).toBeNull())
    return messages.at(-1)!.messageId
  }

  test.each([1, 2])('keeps following a %i-message created branch when generation starts at the tail', async (count) => {
    const { viewport } = await openAtTail()
    const replyId = await createBranch('m218', count)
    expect(typeof h.followOutput).toBe('function')
    act(() => {
      h.atBottom?.(false)
      h.controller!.updateMessage(replyId, { contentParts: [{ type: 'text', text: 'Streaming reply' }] })
    })
    expect(viewport.dataset.followOutput).toBe('auto')
    const pendingLocation = h.scrollIntoViewOnChange?.({ totalCount: 20 })
    expect(pendingLocation).toMatchObject({ index: 19, align: 'end', behavior: 'auto' })
    expect(h.scrollToIndex).not.toHaveBeenCalled()
    const geometry = {
      itemTop: 0,
      itemBottom: 1000,
      viewportTop: 0,
      viewportBottom: 600,
      locationParams: { index: 19, align: 'end' as const },
    }
    expect(pendingLocation?.calculateViewLocation?.(geometry)).toEqual(geometry.locationParams)
    fireEvent.wheel(viewport, { deltaY: -80 })
    expect(pendingLocation?.calculateViewLocation?.(geometry)).toBeNull()
  })

  test('keeps a created branch paused when its shorter content makes a historical reader physically reach the bottom', async () => {
    const { viewport } = await openAtTail()
    fireEvent.wheel(viewport, { deltaY: -80 })
    viewport.scrollTop = 100
    fireEvent.scroll(viewport)
    act(() => h.atBottom?.(false))
    const replyId = await createBranch()
    act(() => {
      h.atBottom?.(true)
      h.controller!.updateMessage(replyId, { contentParts: [{ type: 'text', text: 'Streaming reply' }] })
    })
    expect(h.followOutput).toBe(false)
    expect(h.scrollIntoViewOnChange).toBeUndefined()
    expect(viewport.scrollTop).toBe(100)
    expect(h.scrollToIndex).not.toHaveBeenCalled()
  })

  test('keeps the generating shortcut unmounted while streamed chunks briefly move the followed tail', async () => {
    h.activity = 'generating'
    const { view, viewport } = await openAtTail()
    act(() => h.atBottom?.(true))
    expect(viewport.dataset.followOutput).toBe('auto')
    for (let chunk = 0; chunk < 3; chunk++) {
      // Each chunk grows the reply past the bottom threshold until Virtuoso's follow scroll lands.
      act(() => h.atBottom?.(false))
      expect(view.queryByRole('button', { name: 'Generating...' })).toBeNull()
      act(() => h.atBottom?.(true))
    }
    fireEvent.wheel(viewport, { deltaY: -80 })
    act(() => h.atBottom?.(false))
    expect(view.getByRole('button', { name: 'Generating...' })).toBeTruthy()
  })

  test('keeps the mobile return-to-tail control hidden while followed content grows', async () => {
    h.smallScreen = true
    const { view, viewport } = await openAtTail()
    act(() => h.atBottom?.(true))
    await waitFor(() => expect(view.queryByTestId('mobile-tail')).toBeNull(), { timeout: 3000 })
    act(() => h.atBottom?.(false))
    // The slide-up transition mounts its child after a frame.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(view.queryByTestId('mobile-tail')).toBeNull()
    act(() => h.atBottom?.(true))
    fireEvent.wheel(viewport, { deltaY: -80 })
    act(() => h.atBottom?.(false))
    await waitFor(() => expect(view.getByTestId('mobile-tail')).toBeTruthy(), { timeout: 3000 })
  })

  test('shows the generating shortcut at a historical page bottom with newer messages unloaded', async () => {
    h.activity = 'generating'
    const { view } = await openReadingHistory()
    act(() => h.atBottom?.(true))
    expect(view.getByRole('button', { name: 'Generating...' })).toBeTruthy()
  })

  test('does not follow a created branch from the bottom of a historical page with newer messages unloaded', async () => {
    const { viewport } = await openReadingHistory()
    viewport.scrollTop = 400
    act(() => h.atBottom?.(true))
    expect(h.followOutput).toBe(false)
    await createBranch('m98')
    expect(h.controller!.getSnapshot().hasNewer).toBe(false)
    act(() => h.atBottom?.(true))
    expect(h.followOutput).toBe(false)
    expect(h.scrollToIndex).not.toHaveBeenCalled()
  })

  test('stops following a created branch as soon as the user scrolls up during generation', async () => {
    const { viewport } = await openAtTail()
    const replyId = await createBranch()
    expect(typeof h.followOutput).toBe('function')
    fireEvent.wheel(viewport, { deltaY: -80 })
    act(() => {
      h.atBottom?.(false)
      h.controller!.updateMessage(replyId, { contentParts: [{ type: 'text', text: 'More streaming reply' }] })
    })
    expect(h.followOutput).toBe(false)
  })

  test('follows creation from the physical tail after branch selection paused automatic following', async () => {
    await openAtTail()
    await beginBranch(1)()
    act(() => h.atBottom?.(true))
    expect(h.followOutput).toBe(false)
    await createBranch()
    expect(typeof h.followOutput).toBe('function')
  })

  test('keeps creation paused after the user scrolls up while its branch read is pending', async () => {
    const { viewport } = await openAtTail()
    const finish = beginBranch(1, undefined, 'create')
    expect(typeof h.followOutput).toBe('function')
    fireEvent.wheel(viewport, { deltaY: -80 })
    act(() => h.atBottom?.(true))
    expect(h.followOutput).toBe(false)
    await finish()
    act(() => h.atBottom?.(true))
    expect(h.followOutput).toBe(false)
    expect(h.scrollToIndex).not.toHaveBeenCalled()
  })

  test('does not recapture a historical reader as following when the same created branch read is retried', async () => {
    const { viewport } = await openAtTail()
    fireEvent.wheel(viewport, { deltaY: -80 })
    act(() => h.atBottom?.(false))
    const controller = h.controller!
    const state = controller.getSnapshot()
    const revision = state.revision! + 1
    h.read.mockRejectedValueOnce(new Error('read failed')).mockImplementationOnce(async (request) => {
      const result = page(request)
      return {
        ...result,
        revision,
        older: result.older && { ...result.older, revision },
        newer: result.newer && { ...result.newer, revision },
      }
    })
    await act(async () => {
      expect(
        await controller.applyBranchCommit({
          record: state.pages[0].record,
          previousRevision: state.revision!,
          revision,
          sharedPrefixEnd: { threadId: 't', messageId: 'm218' },
          origin: { messageId: 'm219' },
          branchMode: 'create',
        })
      ).toBe(false)
    })
    const operationId = controller.getSnapshot().operation?.branchOperationId
    act(() => h.atBottom?.(true))
    expect(h.followOutput).toBe(false)
    await act(async () => {
      expect(await controller.retry()).toBe(true)
    })
    await waitFor(() => expect(controller.getSnapshot().operation).toBeNull())
    expect(operationId).toBeDefined()
    expect(h.followOutput).toBe(false)
    expect(h.scrollToIndex).not.toHaveBeenCalled()
  })

  test('pauses following across branch acknowledgement and delayed bottom events', async () => {
    const { listRef } = await openAtTail()
    const beforeSwitch = listRef.current!.captureSendFollow()
    const finishShort = beginBranch(1, () => {
      expect(beforeSwitch?.()).toBe(false)
      expect(listRef.current!.captureSendFollow()).toBeNull()
    })
    expect(h.followOutput).toBe(false)
    act(() => h.atBottom?.(true))
    expect(h.followOutput).toBe(false)
    await finishShort()
    act(() => h.atBottom?.(true))
    expect(h.followOutput).toBe(false)
    const fromShortTail = listRef.current!.captureSendFollow()
    expect(fromShortTail?.()).toBe(true)

    const finishLong = beginBranch(21, () => expect(fromShortTail?.()).toBe(false))
    expect(h.followOutput).toBe(false)
    await finishLong()
    act(() => h.atBottom?.(true))
    expect(h.followOutput).toBe(false)
    expect(h.scrollToIndex).not.toHaveBeenCalled()
  })

  test('resumes paused branch following through an explicit tail request or a send from the physical tail', async () => {
    const { listRef } = await openAtTail()
    await beginBranch(1)()
    act(() => h.atBottom?.(true))
    const followSend = listRef.current!.captureSendFollow()
    expect(followSend?.()).toBe(true)
    expect(h.followOutput).toBe(false)
    act(() => listRef.current!.scrollToBottom())
    await waitFor(() => expect(h.controller!.getSnapshot().layout).toBeNull())
    expect(typeof h.followOutput).toBe('function')
    expect(h.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end' })
  })

  test('allows a send from the short branch tail when the native bottom state stays true', async () => {
    const { listRef } = await openAtTail()
    const priorSend = listRef.current!.captureSendFollow()
    const finishShort = beginBranch(1, () => {
      expect(priorSend?.()).toBe(false)
      expect(listRef.current!.captureSendFollow()).toBeNull()
    })
    await finishShort()
    expect(h.followOutput).toBe(false)
    expect(listRef.current!.captureSendFollow()?.()).toBe(true)
  })

  test.each(['wheel', 'touch', 'keyboard', 'scrollbar'] as const)(
    'resumes branch following only after an actual downward %s scroll reaches the tail',
    async (input) => {
      const { viewport } = await openAtTail()
      await beginBranch(21)()
      viewport.scrollTop = 100
      fireEvent.scroll(viewport)
      act(() => h.atBottom?.(true))
      if (input === 'wheel') fireEvent.wheel(viewport, { deltaY: 80 })
      if (input === 'touch') {
        fireEvent.touchStart(viewport, { touches: [{ clientY: 200 }] })
        fireEvent.touchMove(viewport, { touches: [{ clientY: 120 }] })
      }
      if (input === 'keyboard') fireEvent.keyDown(viewport, { key: 'ArrowDown' })
      if (input === 'scrollbar') {
        const pointer = new MouseEvent('pointerdown', { bubbles: true, button: 0 })
        Object.defineProperties(pointer, { pointerId: { value: 7 }, pointerType: { value: 'mouse' } })
        fireEvent(viewport, pointer)
      }
      expect(h.followOutput).toBe(false)
      viewport.scrollTop = 200
      fireEvent.scroll(viewport)
      expect(h.followOutput).toBe(false)
      act(() => h.atBottom?.(false))
      viewport.scrollTop = 400
      fireEvent.scroll(viewport)
      act(() => h.atBottom?.(true))
      expect(typeof h.followOutput).toBe('function')
    }
  )

  test('keeps branch follow paused for horizontal wheel, unchanged scroll, and a key press without scrolling', async () => {
    const { viewport } = await openAtTail()
    await beginBranch(21)()
    act(() => h.atBottom?.(true))
    fireEvent.wheel(viewport, { deltaX: 80, deltaY: 0 })
    viewport.scrollTop += 10
    fireEvent.scroll(viewport)
    act(() => h.atBottom?.(true))
    expect(h.followOutput).toBe(false)
    fireEvent.keyDown(viewport, { key: 'ArrowDown' })
    fireEvent.scroll(viewport)
    act(() => h.atBottom?.(true))
    expect(h.followOutput).toBe(false)
  })

  test('starts a replacement controller with fresh follow intent', async () => {
    const { listRef, view } = await openAtTail()
    await beginBranch(1)()
    act(() => h.atBottom?.(true))
    const priorSend = listRef.current!.captureSendFollow()
    const previousController = h.controller
    const nextSource = { ...source }
    view.rerender(<Host listRef={listRef} readSource={nextSource} />)
    await waitFor(() => {
      expect(h.controller).not.toBe(previousController)
      expect(h.firstReady).toBe(true)
      expect(h.controller!.getSnapshot().layout).toBeNull()
    })
    expect(priorSend?.()).toBe(false)
    expect(typeof h.followOutput).toBe('function')
    expect(listRef.current!.captureSendFollow()?.()).toBe(true)
  })

  test('keeps following a send made at the tail until the user scrolls away', async () => {
    const { listRef, viewport } = await openAtTail()
    const stillFollowing = listRef.current!.captureSendFollow()
    expect(stillFollowing?.()).toBe(true)
    fireEvent.wheel(viewport, { deltaY: -80 })
    expect(stillFollowing?.()).toBe(false)
  })

  test('keeps active follow intent through a native bottom-state change and withdraws it immediately on user input', async () => {
    const { listRef, viewport } = await openAtTail()
    act(() => h.atBottom?.(false))
    const stillFollowing = listRef.current!.captureSendFollow()
    expect(stillFollowing?.()).toBe(true)
    act(() => {
      viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -80 }))
      expect(stillFollowing?.()).toBe(false)
      expect(listRef.current!.captureSendFollow()).toBeNull()
    })
    expect(h.followOutput).toBe(false)
  })

  test('does not follow a send made while reading history', async () => {
    const { listRef, viewport } = await openAtTail()
    viewport.scrollTop = 100
    act(() => h.atBottom?.(false))
    fireEvent.wheel(viewport, { deltaY: -80 })
    fireEvent.scroll(viewport)
    expect(listRef.current!.captureSendFollow()).toBeNull()
  })

  test('does not follow a send made after jumping to an earlier message', async () => {
    const { listRef } = await openAtTail()
    const stillFollowing = listRef.current!.captureSendFollow()
    act(() => void listRef.current!.scrollToMessage('m180'))
    expect(stillFollowing?.()).toBe(false)
    expect(listRef.current!.captureSendFollow()).toBeNull()
  })

  test.each([
    ['bottom navigation button', 'idle'],
    ['generating shortcut', 'generating'],
  ] as const)('follows a send made right after the %s, before the list reaches the tail', async (_, activity) => {
    h.activity = activity
    const { listRef, view } = await openReadingHistory()
    expect(listRef.current!.captureSendFollow()).toBeNull()
    let releaseTail!: () => void
    h.read.mockImplementationOnce(
      (request) =>
        new Promise((resolve) => {
          releaseTail = () => resolve(page(request))
        })
    )
    fireEvent.click(
      activity === 'idle' ? view.getByTestId('desktop-navigation') : view.getByRole('button', { name: 'Generating...' })
    )
    // The tail is still being read: the list has neither moved nor resumed following yet.
    expect(h.controller!.getSnapshot().hasNewer).toBe(true)
    const stillFollowing = listRef.current!.captureSendFollow()
    expect(stillFollowing?.()).toBe(true)
    await act(async () => releaseTail())
    await waitFor(() => expect(h.controller!.getSnapshot().rows.at(-1)?.messageId).toBe('m219'))
    expect(stillFollowing?.()).toBe(true)
  })

  test('drops the arrow intent when the user scrolls back up before sending', async () => {
    const { listRef, view, viewport } = await openReadingHistory()
    fireEvent.click(view.getByTestId('desktop-navigation'))
    fireEvent.wheel(viewport, { deltaY: -80 })
    expect(listRef.current!.captureSendFollow()).toBeNull()
  })

  test('drops the arrow intent when a touch drags toward older messages before sending', async () => {
    const { listRef, view, viewport } = await openReadingHistory()
    fireEvent.click(view.getByTestId('desktop-navigation'))
    fireEvent.touchStart(viewport, { touches: [{ clientY: 100 }] })
    fireEvent.touchMove(viewport, { touches: [{ clientY: 160 }] })
    expect(listRef.current!.captureSendFollow()).toBeNull()
  })

  test.each([
    ['the Capacitor app', 'mobile', false],
    ['a small screen', 'desktop', true],
  ] as const)('follows a send made while reading history in %s', async (_, platformType, smallScreen) => {
    h.platformType = platformType
    h.smallScreen = smallScreen
    const { listRef } = await openReadingHistory()
    expect(listRef.current!.captureSendFollow()?.()).toBe(true)
  })

  test('stops following a mobile send from history once the user scrolls during the send', async () => {
    h.platformType = 'mobile'
    h.smallScreen = true
    const { listRef, viewport } = await openReadingHistory()
    const stillFollowing = listRef.current!.captureSendFollow()
    expect(stillFollowing?.()).toBe(true)
    fireEvent.touchStart(viewport, { touches: [{ clientY: 100 }] })
    fireEvent.touchMove(viewport, { touches: [{ clientY: 160 }] })
    expect(stillFollowing?.()).toBe(false)
  })
})

describe('Virtuoso positioning', () => {
  test('opens at the native tail and waits for measured items before exposing the conversation', async () => {
    h.acknowledgeMeasurements = false
    const view = render(<Host />)
    await waitFor(() => expect(view.getByTestId('message-m219')).toBeTruthy())
    expect(h.firstReady).toBe(false)
    expect(view.getByTestId('virtuoso').style.visibility).toBe('hidden')
    expect(h.initialLocations.at(-1)).toEqual({ index: 'LAST', align: 'end' })
    act(() => h.itemsRendered?.([{ size: 0 }]))
    expect(h.firstReady).toBe(false)
    act(() => h.itemsRendered?.([{ size: 20 }]))
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(h.scrollToIndex).not.toHaveBeenCalled()
    expect(h.scrollBy).not.toHaveBeenCalled()
    expect(h.scrollTo).not.toHaveBeenCalled()
  })

  test('prepends desktop history during scrolling after upward user input', async () => {
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
    act(() => h.starts.at(-1)?.())
    expect(h.read).toHaveBeenCalledTimes(1)
    act(() => h.isScrolling?.(true))
    fireEvent.wheel(viewport, { deltaY: -80 })
    await waitFor(() => expect(h.controller!.getSnapshot().rows[0].messageId).toBe('m20'))
    await waitFor(() => expect(h.controller!.getSnapshot().layout).toBeNull())
    expect(view.getByTestId('virtuoso')).toBe(viewport)
    expect(viewport.dataset.firstIndex).toBe('999900')
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.scrollToIndex).not.toHaveBeenCalled()
    expect(h.scrollBy).not.toHaveBeenCalled()
    expect(h.scrollTo).not.toHaveBeenCalled()
  })

  test('keeps the history indicator visible while iOS scrolling settles and the page is read', async () => {
    h.platformType = 'mobile'
    getDefaultStore().set(platformTypeAtom, 'ios')
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    const pendingHistory = view.getByRole('status')
    expect(pendingHistory.textContent).toBe('Loading...')
    let releaseHistory!: () => void
    h.read.mockImplementationOnce(
      (request: SessionTranscriptRequest) =>
        new Promise<SessionTranscriptPage>((resolve) => {
          releaseHistory = () => resolve(page(request))
        })
    )
    viewport.scrollTop = 40
    act(() => h.isScrolling?.(true))
    fireEvent.touchStart(viewport, { touches: [{ clientY: 200 }] })
    fireEvent.touchMove(viewport, { touches: [{ clientY: 260 }] })
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(view.getByRole('status')).toBe(pendingHistory)

    viewport.scrollTop = -25
    fireEvent.scroll(viewport)
    fireEvent.touchEnd(viewport, { touches: [] })
    act(() => h.isScrolling?.(false))
    for (const scrollTop of [-8, -1]) {
      viewport.scrollTop = scrollTop
      fireEvent.scroll(viewport)
    }
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(view.getByRole('status')).toBe(pendingHistory)

    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
    expect(h.read).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(h.read).toHaveBeenCalledTimes(2))
    expect(h.controller!.getSnapshot().rows[0].messageId).toBe('m120')
    expect(view.getByRole('status')).toBe(pendingHistory)
    await act(async () => releaseHistory())
    await waitFor(() => expect(h.controller!.getSnapshot().rows[0].messageId).toBe('m20'))
    await waitFor(() => expect(h.controller!.getSnapshot().layout).toBeNull())
    expect(h.controller!.getSnapshot().hasOlder).toBe(true)
    expect(view.getByRole('status')).toBe(pendingHistory)
    act(() => {
      h.isScrolling?.(false)
      h.starts.at(-1)?.()
    })
    fireEvent.scroll(viewport)
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  test('waits for the final iOS bottom bounce event even when Virtuoso already reports idle', async () => {
    h.platformType = 'mobile'
    getDefaultStore().set(platformTypeAtom, 'ios')
    const view = render(<Host search="m0" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    viewport.scrollTop = 401
    fireEvent.touchStart(viewport, { touches: [{ clientY: 260 }] })
    fireEvent.touchMove(viewport, { touches: [{ clientY: 200 }] })
    fireEvent.touchEnd(viewport, { touches: [] })
    act(() => h.isScrolling?.(false))
    expect(h.read).toHaveBeenCalledTimes(1)

    viewport.scrollTop = 400
    fireEvent.scroll(viewport)
    expect(h.read).toHaveBeenCalledTimes(1)
    act(() => h.isScrolling?.(false))
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(view.getByRole('status').textContent).toBe('Loading...')
    await waitFor(() => expect(h.controller!.getSnapshot().rows.at(-1)?.messageId).toBe('m199'))
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  test('waits for every iOS touch to end when Virtuoso already reports idle', async () => {
    h.platformType = 'mobile'
    getDefaultStore().set(platformTypeAtom, 'ios')
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    viewport.scrollTop = 0
    fireEvent.touchStart(viewport, { touches: [{ clientY: 200 }, { clientY: 240 }] })
    fireEvent.touchMove(viewport, { touches: [{ clientY: 260 }, { clientY: 300 }] })
    act(() => {
      h.isScrolling?.(false)
      h.starts.at(-1)?.()
    })
    expect(h.read).toHaveBeenCalledTimes(1)

    fireEvent.touchEnd(viewport, { touches: [{ clientY: 300 }] })
    expect(h.read).toHaveBeenCalledTimes(1)

    fireEvent.touchEnd(viewport, { touches: [] })
    await waitFor(() => expect(h.controller!.getSnapshot().rows[0].messageId).toBe('m20'))
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  test('uses native initial and explicit message indexes for search', async () => {
    render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(h.initialLocations.at(-1)).toEqual({ index: 49, align: 'start' })
    act(() => void h.navigation?.navigateMessage('m70'))
    await waitFor(() => expect(h.controller!.getSnapshot().layout).toBeNull())
    expect(h.scrollToIndex).toHaveBeenCalledExactlyOnceWith({ index: 59, align: 'start' })
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  test('starts previous and next user navigation at the viewport message while overscan rows are mounted', async () => {
    const view = render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    viewport.getBoundingClientRect = () => ({ top: 0, bottom: 600 }) as DOMRect
    const messages = Array.from(view.container.querySelectorAll<HTMLElement>('[data-transcript-message]'))
    expect(messages[0].dataset.transcriptMessage).toBe('m11')
    for (const message of messages) {
      const top = (Number(message.dataset.transcriptMessage?.slice(1)) - 60) * 100
      message.getBoundingClientRect = () => ({ top, bottom: top + 100 }) as DOMRect
    }
    fireEvent.click(view.getByRole('button', { name: 'Previous message' }))
    expect(h.scrollToIndex).toHaveBeenLastCalledWith({ index: 47, align: 'start', behavior: 'smooth' })
    fireEvent.click(view.getByRole('button', { name: 'Next message' }))
    expect(h.scrollToIndex).toHaveBeenLastCalledWith({ index: 51, align: 'start', behavior: 'smooth' })
    expect(h.scrollBy).not.toHaveBeenCalled()
    expect(h.scrollTo).not.toHaveBeenCalled()
  })

  test('delegates output following to Virtuoso and resumes it through the tail action', async () => {
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    expect(viewport.dataset.followOutput).toBe('auto')
    expect(typeof h.followOutput).toBe('function')
    const activeFollowOutput = h.followOutput
    if (typeof activeFollowOutput !== 'function') throw new Error('Expected active output following')
    expect(activeFollowOutput(false)).toBe('auto')
    fireEvent.wheel(viewport, { deltaY: -80 })
    expect(viewport.dataset.followOutput).toBe('false')
    expect(h.followOutput).toBe(false)
    fireEvent.click(view.getByTestId('desktop-navigation'))
    await waitFor(() => expect(h.controller!.getSnapshot().layout).toBeNull())
    expect(viewport.dataset.followOutput).toBe('auto')
    expect(h.followOutput).toBe(activeFollowOutput)
    expect(h.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end' })
  })

  test('keeps history pagination from following the loaded bottom, including the final newer page', async () => {
    const view = render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    expect(h.controller!.getSnapshot().hasNewer).toBe(true)
    act(() => h.atBottom?.(true))
    expect(viewport.dataset.followOutput).toBe('false')
    expect(h.followOutput).toBe(false)

    act(() => void h.controller!.loadNewer())
    await waitFor(() => expect(h.controller!.getSnapshot().rows.at(-1)?.messageId).toBe('m210'))
    await waitFor(() => expect(h.controller!.getSnapshot().layout).toBeNull())
    expect(h.controller!.getSnapshot().hasNewer).toBe(true)
    act(() => h.atBottom?.(true))
    expect(viewport.dataset.followOutput).toBe('false')

    act(() => void h.controller!.loadNewer())
    await waitFor(() => expect(h.controller!.getSnapshot().hasNewer).toBe(false))
    await waitFor(() => expect(h.controller!.getSnapshot().layout).toBeNull())
    expect(h.controller!.getSnapshot().rows.at(-1)?.messageId).toBe('m219')
    expect(viewport.dataset.followOutput).toBe('false')
    expect(h.followOutput).toBe(false)
    expect(h.scrollToIndex).not.toHaveBeenCalled()

    fireEvent.click(view.getByTestId('desktop-navigation'))
    await waitFor(() => expect(h.controller!.getSnapshot().layout).toBeNull())
    expect(viewport.dataset.followOutput).toBe('auto')
    expect(h.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end' })
  })
})
