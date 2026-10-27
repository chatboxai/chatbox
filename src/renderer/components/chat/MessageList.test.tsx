// @vitest-environment jsdom
import type { SessionHeaderRead, SessionTranscriptPage, SessionTranscriptRequest } from '@chatbox/core/ports'
import { useSessionTranscript } from '@chatbox/react/query'
import { MantineProvider } from '@mantine/core'
import type { Message as Body } from '@shared/types'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
  rowTop: 580,
  rowOffsets: new Map<string, number>(),
  scrollBy: vi.fn(),
  navigation: null as TranscriptNavigation | null,
  firstReady: false,
  tailMounted: true,
  unmountedItems: new Set<string>(),
  measuredHeight: 1000,
  currentScroller: null as HTMLDivElement | null,
  heightChanged: null as ((height: number) => void) | null,
  initialLocations: [] as unknown[],
  hideSystem: false,
  threadCount: 1,
  agentMode: 'off' as 'off' | 'on',
  renderMenu: vi.fn(),
  smallScreen: false,
  activity: 'idle' as 'idle' | 'generating',
  atTop: null as ((value: boolean) => void) | null,
  atBottom: null as ((value: boolean) => void) | null,
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
        threads: Array.from({ length: h.threadCount }, (_, index) => ({ threadId: `thread-${index}` })),
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
vi.mock('@/lib/utils', () => ({ cn: (...items: unknown[]) => items.filter(Boolean).join(' ') }))
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
  default: ({ msg, readOnly }: { msg: Body; readOnly?: boolean }) => {
    h.bodyModes.push({ id: msg.id, readOnly })
    return <div data-testid={`message-${msg.id}`}>{msg.role}</div>
  },
}))
vi.mock('./SummaryMessage', () => ({ default: ({ msg }: { msg: Body }) => <div>{msg.id}</div> }))
vi.mock('./ForkMarkerMessage', () => ({ default: () => null }))
vi.mock('./ForkGroup', () => ({ default: ({ msgId }: { msgId: string }) => <div data-testid={`fork-${msgId}`} /> }))
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
          rangeChanged(): void
          startReached(): void
          onScroll(): void
          totalListHeightChanged(height: number): void
          atTopStateChange(value: boolean): void
          atBottomStateChange(value: boolean): void
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
            element.current.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 }) as DOMRect
            for (const row of Array.from(
              element.current.querySelectorAll<HTMLElement>('[data-transcript-message], .w-full')
            ))
              row.getBoundingClientRect = () => {
                const top = h.rowTop + (h.rowOffsets.get(row.dataset.transcriptMessage ?? '') ?? 0)
                return { top, bottom: top + 20, height: 20 } as DOMRect
              }
          }
          h.initialLocations.push(props.initialTopMostItemIndex)
          props.scrollerRef(element.current)
          if (h.acknowledgeMeasurements) props.rangeChanged()
        }, [props])
        h.heightChanged = props.totalListHeightChanged
        h.atTop = props.atTopStateChange
        h.atBottom = props.atBottomStateChange
        h.starts.push(props.startReached)
        return (
          <div
            ref={element}
            style={props.style}
            className={props.className}
            data-testid="virtuoso"
            data-first-index={props.firstItemIndex}
            onScroll={props.onScroll}
          >
            {props.components && <props.components.Header context={props.context} />}
            {props.data.map((item, index) =>
              !h.unmountedItems.has(item.key) && (h.tailMounted || index < props.data.length - 1) ? (
                <div key={item.key}>{props.itemContent(index, item)}</div>
              ) : null
            )}
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
  captureAnchor,
  search,
  read = header,
}: {
  listRef?: React.Ref<MessageListRef>
  captureAnchor?: MessageListRef['captureAnchor']
  search?: string
  read?: SessionHeaderRead
}) {
  const transcript = useSessionTranscript({
    sessionId: 's',
    platform: 'web',
    source,
    bridge,
    captureAnchor,
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
  h.tailMounted = true
  h.unmountedItems.clear()
  h.measuredHeight = 1000
  h.rowTop = 580
  h.rowOffsets.clear()
  h.currentScroller = null
  h.heightChanged = null
  h.initialLocations.length = 0
  h.hideSystem = false
  h.threadCount = 1
  h.agentMode = 'off'
  h.renderMenu.mockClear()
  h.smallScreen = false
  h.activity = 'idle'
  h.atTop = null
  h.atBottom = null
  h.acknowledgeMeasurements = true
  h.starts.length = 0
  h.minimapProps = null
  h.bodyModes.length = 0
  h.scrollTo.mockReset().mockImplementation(({ top }: { top: number }) => {
    if (h.currentScroller) h.currentScroller.scrollTop = top
  })
  h.scrollBy.mockReset().mockImplementation(({ top }: { top: number }) => {
    h.rowTop -= top
    if (h.currentScroller) h.currentScroller.scrollTop += top
  })
  h.scrollIntoView
    .mockReset()
    .mockImplementation((request: Parameters<import('react-virtuoso').VirtuosoHandle['scrollIntoView']>[0]) => {
      expect(
        request.calculateViewLocation?.({
          itemTop: 0,
          itemBottom: h.measuredHeight,
          viewportTop: h.currentScroller?.scrollTop ?? 0,
          viewportBottom: (h.currentScroller?.scrollTop ?? 0) + 600,
          locationParams: request,
        })
      ).toBeNull()
    })
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

function pointerEvent(target: Element | Document, type: 'pointerdown' | 'pointerup' | 'pointercancel') {
  const event = new MouseEvent(type, { bubbles: true, button: 0 })
  Object.defineProperties(event, { pointerId: { value: 7 }, pointerType: { value: 'mouse' } })
  fireEvent(target, event)
}
function scrollGeometry(element: HTMLElement, scrollTop: number) {
  Object.defineProperties(element, {
    clientHeight: { value: 600, configurable: true },
    scrollHeight: { value: 2000, configurable: true },
  })
  element.scrollTop = scrollTop
}

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
    fireEvent.click(view.getByRole('button', { name: 'Generating...' }))
    await waitFor(() => expect(h.controller?.getSnapshot().rows.at(-1)?.messageId).toBe('m219'))
    act(() => h.atBottom?.(true))
    expect(view.queryByRole('button', { name: 'Generating...' })).toBeNull()
  })
  test.each(['Return to the top', 'Back to previous message'])(
    'restores the small-screen %s action after upward scrolling',
    async (label) => {
      h.smallScreen = true
      const view = render(<Host search="m60" />)
      await waitFor(() => expect(h.firstReady).toBe(true))
      expect(view.queryByRole('button', { name: label })).toBeNull()
      const viewport = view.getByTestId('virtuoso')
      scrollGeometry(viewport, 800)
      fireEvent.scroll(viewport)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 270))
      })
      viewport.scrollTop = 700
      fireEvent.scroll(viewport)
      await waitFor(() => expect(view.getByRole('button', { name: label })).toBeTruthy())
      fireEvent.click(view.getByRole('button', { name: label }))
      await waitFor(() => expect(h.controller?.getSnapshot().operation).toBeNull())
      if (label === 'Return to the top')
        expect(h.read.mock.calls.at(-1)?.[0]).toMatchObject({ origin: 'head', limit: 100 })
      else expect(h.read).toHaveBeenCalledTimes(1)
    }
  )
  test.each([
    { label: 'Previous message', index: 47 },
    { label: 'Next message', index: 51 },
  ])('smoothly scrolls to the loaded $label without a navigation transaction', async ({ label, index }) => {
    const view = render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    scrollGeometry(viewport, 800)
    viewport.getBoundingClientRect = () => ({ top: 40, bottom: 640, height: 600 }) as DOMRect
    h.rowTop = 40
    for (let siblingOrder = 11; siblingOrder < 111; siblingOrder++)
      h.rowOffsets.set(`m${siblingOrder}`, (siblingOrder - 60) * 100)
    h.scrollIntoView.mockClear()
    h.scrollTo.mockClear()
    h.scrollToIndex.mockClear()
    fireEvent.click(view.getByRole('button', { name: label }))
    expect(h.scrollToIndex).toHaveBeenCalledExactlyOnceWith({ index, align: 'start', behavior: 'smooth' })
    expect(h.scrollTo).not.toHaveBeenCalled()
    expect(h.scrollIntoView).not.toHaveBeenCalled()
    expect(h.controller?.getSnapshot().operation).toBeNull()
    expect(h.controller?.getSnapshot().layout).toBeNull()
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  test.each([
    { label: 'Previous message', target: 'm58', index: 47 },
    { label: 'Next message', target: 'm62', index: 51 },
  ])('scrolls to the loaded $label when its target is not mounted', async ({ label, target, index }) => {
    h.unmountedItems.add(target)
    const view = render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    h.rowTop = 0
    for (let siblingOrder = 11; siblingOrder < 111; siblingOrder++)
      h.rowOffsets.set(`m${siblingOrder}`, (siblingOrder - 60) * 100)
    expect(h.controller?.getSnapshot().rows.some((row) => row.messageId === target)).toBe(true)
    expect(view.container.querySelector(`[data-transcript-message="${target}"]`)).toBeNull()
    h.scrollIntoView.mockClear()
    h.scrollTo.mockClear()
    h.scrollToIndex.mockClear()
    fireEvent.click(view.getByRole('button', { name: label }))
    expect(h.scrollTo).not.toHaveBeenCalled()
    expect(h.scrollIntoView).not.toHaveBeenCalled()
    expect(h.scrollToIndex).toHaveBeenCalledExactlyOnceWith({ index, align: 'start', behavior: 'smooth' })
    expect(h.controller?.getSnapshot().operation).toBeNull()
    expect(h.controller?.getSnapshot().layout).toBeNull()
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  test.each([
    { label: 'Previous message', current: 12 },
    { label: 'Next message', current: 110 },
  ])('does nothing when the $label is outside the loaded rows', async ({ label, current }) => {
    const view = render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    h.rowTop = 0
    for (let siblingOrder = 11; siblingOrder < 111; siblingOrder++)
      h.rowOffsets.set(`m${siblingOrder}`, (siblingOrder - current) * 100)
    h.scrollIntoView.mockClear()
    h.scrollTo.mockClear()
    fireEvent.click(view.getByRole('button', { name: label }))
    expect(h.scrollIntoView).not.toHaveBeenCalled()
    expect(h.scrollTo).not.toHaveBeenCalled()
    expect(h.scrollToIndex).not.toHaveBeenCalled()
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  test('returns to the beginning of a partially visible user message before the earlier user turn', async () => {
    const view = render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    scrollGeometry(view.getByTestId('virtuoso'), 800)
    h.rowTop = -10
    for (let siblingOrder = 11; siblingOrder < 111; siblingOrder++)
      h.rowOffsets.set(`m${siblingOrder}`, (siblingOrder - 60) * 100)
    h.scrollToIndex.mockClear()
    fireEvent.click(view.getByRole('button', { name: 'Previous message' }))
    expect(h.scrollToIndex).toHaveBeenCalledExactlyOnceWith({ index: 49, align: 'start', behavior: 'smooth' })
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
    expect(view.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Try Again' }))
    expect(view.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(h.read).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(view.getByTestId('session-transcript').dataset.transcriptFirstMessageId).toBe('m0'))
    expect(view.queryByRole('alert')).toBeNull()
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
    expect(view.getByTestId('virtuoso').lastElementChild?.contains(notice)).toBe(true)
    expect(view.queryByRole('button', { name: 'Dismiss' })).toBeNull()
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

  test('still scrolls between loaded messages after a page read fails', async () => {
    const view = render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    h.read.mockRejectedValueOnce(new Error('Page read failed'))
    await act(async () => {
      await h.controller?.loadOlder()
    })
    expect(h.controller?.getSnapshot().operation?.phase).toBe('error')
    scrollGeometry(view.getByTestId('virtuoso'), 800)
    h.rowTop = 0
    for (let siblingOrder = 11; siblingOrder < 111; siblingOrder++)
      h.rowOffsets.set(`m${siblingOrder}`, (siblingOrder - 60) * 100)
    h.scrollToIndex.mockClear()
    fireEvent.click(view.getByRole('button', { name: 'Previous message' }))
    expect(h.scrollToIndex).toHaveBeenCalledExactlyOnceWith({ index: 47, align: 'start', behavior: 'smooth' })
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  test('clears earlier wheel intent during a message jump and accepts fresh wheel paging', async () => {
    const view = render(<Host search="m60" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    scrollGeometry(viewport, 800)
    fireEvent.wheel(viewport, { deltaY: -80 })
    h.rowTop = 0
    for (let siblingOrder = 11; siblingOrder < 111; siblingOrder++)
      h.rowOffsets.set(`m${siblingOrder}`, (siblingOrder - 14) * 100)
    h.scrollToIndex.mockClear()
    fireEvent.click(view.getByRole('button', { name: 'Previous message' }))
    expect(h.scrollToIndex).toHaveBeenCalledExactlyOnceWith({ index: 1, align: 'start', behavior: 'smooth' })
    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
    act(() => h.starts.at(-1)?.())
    expect(h.read).toHaveBeenCalledTimes(1)
    fireEvent.wheel(viewport, { deltaY: -80 })
    await waitFor(() => expect(h.read).toHaveBeenCalledTimes(2))
    expect(h.read.mock.calls[1][0]).toMatchObject({ cursor: { direction: 'before' } })
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
    expect(view.getByTestId('virtuoso').dataset.firstIndex).toBe('0')
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
    expect(root?.getBoundingClientRect().top).toBe(0)
  })
  test('stops following after focus scrolls from the acknowledged tail into the message', async () => {
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    expect(viewport.scrollTop).toBe(400)
    act(() => h.heightChanged?.(1000))
    h.scrollTo.mockClear()
    viewport.scrollTop = 200
    fireEvent.scroll(viewport)
    expect(h.scrollTo).toHaveBeenCalledWith({ top: 200, behavior: 'auto' })
    h.scrollTo.mockClear()
    vi.useFakeTimers()
    try {
      await act(async () => {
        h.measuredHeight = 1600
        h.heightChanged?.(1600)
        await vi.advanceTimersByTimeAsync(50)
      })
      expect(h.scrollTo).not.toHaveBeenCalled()
      expect(viewport.scrollTop).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  test('keeps explicit Tail following after acknowledging a shorter window', async () => {
    h.measuredHeight = 8000
    const listRef = createRef<MessageListRef>()
    const view = render(<Host listRef={listRef} />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    viewport.scrollTop = 6000
    fireEvent.scroll(viewport)
    h.measuredHeight = 1000
    act(() => listRef.current?.scrollToBottom())
    await waitFor(() => {
      expect(h.controller!.getSnapshot().layout).toBeNull()
      expect(viewport.scrollTop).toBe(400)
    })
    act(() => h.heightChanged?.(1000))
    h.scrollTo.mockClear()
    vi.useFakeTimers()
    try {
      await act(async () => {
        h.measuredHeight = 1100
        h.heightChanged?.(1100)
        await vi.advanceTimersByTimeAsync(50)
      })
      expect(h.scrollTo).toHaveBeenCalledWith({ top: 500, behavior: 'smooth' })
    } finally {
      vi.useRealTimers()
    }
  })

  test('reveals the first window after the virtual tail is measured', async () => {
    h.tailMounted = false
    const view = render(<Host />)
    await waitFor(() => expect(h.scrollIntoView).toHaveBeenCalled())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)))
    expect(h.firstReady).toBe(false)
    expect(view.queryByTestId('minimap')).toBeNull()
    expect(getComputedStyle(view.getByTestId('virtuoso')).visibility).toBe('hidden')
    expect(view.container.querySelector('.mantine-Loader-root')).toBeNull()
    h.tailMounted = true
    h.measuredHeight = 8000
    view.rerender(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(getComputedStyle(view.getByTestId('virtuoso')).visibility).toBe('visible')
    expect(view.container.querySelector('.mantine-Loader-root')).toBeNull()
    expect(h.currentScroller?.scrollTop).toBe(7400)
    expect(h.initialLocations.at(-1)).toBe(0)
    expect(h.scrollToIndex).not.toHaveBeenCalled()
  })
  test('rejects an unmeasurable tail within a bounded deadline and keeps token navigation gated', async () => {
    vi.useFakeTimers()
    try {
      h.tailMounted = false
      const view = render(<Host />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100)
      })
      expect(h.firstReady).toBe(false)
      expect(view.queryByTestId('minimap')).toBeNull()
      expect(view.getByText('Try Again')).toBeTruthy()
      expect(view.container.querySelector('.mantine-Loader-root')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
  test('settles the tail when rendering a long message blocks frames past the deadline', async () => {
    vi.useFakeTimers()
    try {
      let blocked = true
      // A slow device spends several seconds rendering a long message before the next frame.
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        const delay = blocked ? 6000 : 16
        blocked = false
        return setTimeout(() => callback(performance.now()), delay)
      })
      vi.stubGlobal('cancelAnimationFrame', clearTimeout)
      const view = render(<Host />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6100)
      })
      expect(view.queryByText('Try Again')).toBeNull()
      expect(h.firstReady).toBe(true)
      expect(h.currentScroller?.scrollTop).toBe(400)
    } finally {
      vi.useRealTimers()
    }
  })
  test('loads one older page only after upward user input', async () => {
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    act(() => h.starts.at(-1)?.())
    expect(h.read).toHaveBeenCalledTimes(1)
    view.getByTestId('virtuoso').scrollTop = 0
    fireEvent.wheel(view.container.querySelector('[data-session-view]')!, { deltaY: -40 })
    await waitFor(() => expect(h.read).toHaveBeenCalledTimes(2))
    expect(h.read.mock.calls[1][0].cursor).toMatchObject({ direction: 'before', messageId: 'm120' })
    await waitFor(() =>
      expect(view.container.querySelector('[data-session-view]')?.getAttribute('aria-busy')).toBe('false')
    )
    expect(h.scrollToIndex).not.toHaveBeenCalled()
    expect(h.scrollIntoView).not.toHaveBeenCalled()
  })
  test.each(['older', 'newer'] as const)(
    'loads one %s page from touch movement at a clamped edge',
    async (direction) => {
      const view = render(<Host search={direction === 'newer' ? 'm0' : undefined} />)
      await waitFor(() => expect(h.firstReady).toBe(true))
      const viewport = view.getByTestId('virtuoso')
      scrollGeometry(viewport, direction === 'older' ? 0 : 1400)
      const before = h.read.mock.calls.length
      fireEvent.touchStart(viewport, { touches: [{ clientY: 240 }] })
      fireEvent.touchMove(viewport, { touches: [{ clientY: direction === 'older' ? 280 : 200 }] })
      fireEvent.touchEnd(viewport)
      await waitFor(() => expect(h.read).toHaveBeenCalledTimes(before + 1))
      expect(h.read.mock.calls.at(-1)![0].cursor).toMatchObject({
        direction: direction === 'older' ? 'before' : 'after',
        messageId: direction === 'older' ? 'm120' : 'm99',
      })
      await waitFor(() => expect(h.controller!.getSnapshot().operation).toBeNull())
      expect(h.read).toHaveBeenCalledTimes(before + 1)
    }
  )

  test.each(['open', 'navigate', 'branch'] as const)(
    '%s invalidates old browsing input before programmatic edge callbacks',
    async (kind) => {
      const view = render(<Host />)
      await waitFor(() => expect(h.firstReady).toBe(true))
      const controller = h.controller!
      const older = vi.spyOn(controller, 'loadOlder')
      let viewport = view.getByTestId('virtuoso')
      viewport.scrollTop = 0
      fireEvent.wheel(viewport, { deltaY: -40 })
      await waitFor(() => expect(controller.getSnapshot().operation).toBeNull())
      expect(h.read).toHaveBeenCalledTimes(2)
      expect(older).toHaveBeenLastCalledWith(1)
      h.read.mockImplementation(async (request: SessionTranscriptRequest) => {
        const result = page(request)
        const revision = request.expectedRevision ?? 1
        return {
          ...result,
          revision,
          older: result.older && { ...result.older, revision },
          newer: result.newer && { ...result.newer, revision },
        }
      })
      await act(async () => {
        if (kind === 'branch')
          await controller.applyBranchCommit({
            record: { id: 's', name: 'Chat', storageFormat: 'rows', activeThreadId: 't' },
            previousRevision: 1,
            revision: 2,
            sharedPrefixEnd: { threadId: 't', messageId: null },
            origin: { messageId: 'm120' },
          })
        else await controller[kind]({ messageId: 'm120' })
      })
      await waitFor(() => expect(controller.getSnapshot().operation).toBeNull())
      const before = h.read.mock.calls.length
      viewport = view.getByTestId('virtuoso')
      viewport.scrollTop = 0
      fireEvent.scroll(viewport)
      act(() => h.starts.at(-1)?.())
      expect(h.read).toHaveBeenCalledTimes(before)
      fireEvent.wheel(viewport, { deltaY: -40 })
      await waitFor(() => expect(h.read).toHaveBeenCalledTimes(before + 1))
      expect(older).toHaveBeenLastCalledWith(2)
    }
  )

  test.each(['wheel', 'touch'] as const)('keeps new %s input received during the same open request', async (input) => {
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const controller = h.controller!
    let finish!: (value: SessionTranscriptPage) => void
    h.read.mockImplementationOnce(
      () =>
        new Promise<SessionTranscriptPage>((resolve) => {
          finish = resolve
        })
    )
    let pending!: Promise<boolean>
    act(() => {
      pending = controller.open({ messageId: 'm120' })
      const viewport = view.getByTestId('virtuoso')
      scrollGeometry(viewport, 400)
      if (input === 'wheel') fireEvent.wheel(viewport, { deltaY: -40 })
      else {
        fireEvent.touchStart(viewport, { touches: [{ clientY: 200 }] })
        fireEvent.touchMove(viewport, { touches: [{ clientY: 240 }] })
        fireEvent.touchEnd(viewport)
      }
    })
    const request = h.read.mock.calls.at(-1)![0] as SessionTranscriptRequest
    await act(async () => {
      finish(page(request))
      await pending
    })
    await waitFor(() => expect(controller.getSnapshot().operation).toBeNull())
    const before = h.read.mock.calls.length
    const viewport = view.getByTestId('virtuoso')
    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
    await waitFor(() => expect(h.read).toHaveBeenCalledTimes(before + 1))
    expect(h.read.mock.calls.at(-1)![0].cursor).toMatchObject({ direction: 'before', messageId: 'm71' })
  })

  test('requires a new touch start after an explicit window operation', async () => {
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    fireEvent.touchStart(viewport, { touches: [{ clientY: 200 }] })
    await act(async () => {
      await h.controller!.open({ messageId: 'm120' })
    })
    await waitFor(() => expect(h.controller!.getSnapshot().operation).toBeNull())
    const before = h.read.mock.calls.length
    const next = view.getByTestId('virtuoso')
    next.scrollTop = 0
    fireEvent.touchMove(next, { touches: [{ clientY: 240 }] })
    fireEvent.scroll(next)
    expect(h.read).toHaveBeenCalledTimes(before)
    fireEvent.touchStart(next, { touches: [{ clientY: 200 }] })
    fireEvent.touchMove(next, { touches: [{ clientY: 240 }] })
    fireEvent.scroll(next)
    await waitFor(() => expect(h.read).toHaveBeenCalledTimes(before + 1))
  })

  test('drops an old scrollbar drag when explicit navigation starts', async () => {
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const old = view.getByTestId('virtuoso')
    scrollGeometry(old, 400)
    pointerEvent(old, 'pointerdown')
    await act(async () => {
      await h.controller!.navigate({ messageId: 'm120' })
    })
    await waitFor(() => expect(h.controller!.getSnapshot().operation).toBeNull())
    const before = h.read.mock.calls.length
    const next = view.getByTestId('virtuoso')
    scrollGeometry(next, 100)
    fireEvent.scroll(next)
    expect(h.read).toHaveBeenCalledTimes(before)
    pointerEvent(next, 'pointerdown')
    next.scrollTop = 0
    fireEvent.scroll(next)
    await waitFor(() => expect(h.read).toHaveBeenCalledTimes(before + 1))
  })

  test.each(['older', 'newer'] as const)(
    'requires fresh touch movement after completing an ordinary %s page',
    async (direction) => {
      const view = render(<Host search={direction === 'newer' ? 'm0' : 'm200'} />)
      await waitFor(() => expect(h.firstReady).toBe(true))
      const controller = h.controller!
      let finish!: (value: SessionTranscriptPage) => void
      h.read.mockImplementationOnce(
        () =>
          new Promise<SessionTranscriptPage>((resolve) => {
            finish = resolve
          })
      )
      const viewport = view.getByTestId('virtuoso')
      const step = direction === 'older' ? 40 : -40
      scrollGeometry(viewport, direction === 'older' ? 0 : 1400)
      fireEvent.touchStart(viewport, { touches: [{ clientY: 240 }] })
      fireEvent.touchMove(viewport, { touches: [{ clientY: 240 + step }] })
      expect(controller.getSnapshot().operation?.kind).toBe(direction)
      const request = h.read.mock.calls.at(-1)![0] as SessionTranscriptRequest
      fireEvent.touchMove(viewport, { touches: [{ clientY: 240 + step * 2 }] })
      await act(async () => {
        finish(page(request))
      })
      await waitFor(() => expect(controller.getSnapshot().operation).toBeNull())
      const before = h.read.mock.calls.length
      scrollGeometry(viewport, direction === 'older' ? 0 : 1400)
      fireEvent.scroll(viewport)
      act(() => h.starts.at(-1)?.())
      expect(h.read).toHaveBeenCalledTimes(before)
      fireEvent.touchMove(viewport, { touches: [{ clientY: 240 + step * 3 }] })
      fireEvent.touchEnd(viewport)
      await waitFor(() => expect(controller.getSnapshot().operation).toBeNull())
      expect(h.read).toHaveBeenCalledTimes(before + 1)
      expect(h.read.mock.calls.at(-1)![0].cursor).toMatchObject({
        direction: direction === 'older' ? 'before' : 'after',
        messageId: direction === 'older' ? 'm20' : 'm199',
      })
    }
  )

  test.each(['wheel', 'scrollbar'] as const)(
    'accepts fresh %s input after consuming completed touch pagination',
    async (input) => {
      const view = render(<Host search="m200" />)
      await waitFor(() => expect(h.firstReady).toBe(true))
      const viewport = view.getByTestId('virtuoso')
      let finish!: (value: SessionTranscriptPage) => void
      h.read.mockImplementationOnce(
        () =>
          new Promise<SessionTranscriptPage>((resolve) => {
            finish = resolve
          })
      )
      scrollGeometry(viewport, 0)
      fireEvent.touchStart(viewport, { touches: [{ clientY: 200 }] })
      fireEvent.touchMove(viewport, { touches: [{ clientY: 240 }] })
      const request = h.read.mock.calls.at(-1)![0] as SessionTranscriptRequest
      fireEvent.touchMove(viewport, { touches: [{ clientY: 280 }] })
      fireEvent.touchEnd(viewport)
      await act(async () => finish(page(request)))
      await waitFor(() => expect(h.controller!.getSnapshot().operation).toBeNull())
      scrollGeometry(viewport, 0)
      fireEvent.scroll(viewport)
      expect(h.read).toHaveBeenCalledTimes(2)
      if (input === 'wheel') fireEvent.wheel(viewport, { deltaY: -40 })
      else {
        scrollGeometry(viewport, 200)
        pointerEvent(viewport, 'pointerdown')
        viewport.scrollTop = 0
        fireEvent.scroll(viewport)
        pointerEvent(document, 'pointerup')
      }
      await waitFor(() => expect(h.controller!.getSnapshot().operation).toBeNull())
      expect(h.read).toHaveBeenCalledTimes(3)
      expect(h.read.mock.calls.at(-1)![0].cursor).toMatchObject({ direction: 'before', messageId: 'm20' })
    }
  )

  test.each(['older', 'newer'] as const)(
    'keeps the fresh touch move that yields an ordinary %s layout',
    async (direction) => {
      const view = render(<Host search={direction === 'newer' ? 'm0' : 'm200'} />)
      await waitFor(() => expect(h.firstReady).toBe(true))
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn(() => 1)
      )
      vi.stubGlobal('cancelAnimationFrame', vi.fn())
      const viewport = view.getByTestId('virtuoso')
      const step = direction === 'older' ? 40 : -40
      scrollGeometry(viewport, direction === 'older' ? 0 : 1400)
      fireEvent.touchStart(viewport, { touches: [{ clientY: 240 }] })
      fireEvent.touchMove(viewport, { touches: [{ clientY: 240 + step }] })
      await waitFor(() => expect(h.controller!.getSnapshot().operation?.phase).toBe('layout'))
      expect(h.read).toHaveBeenCalledTimes(2)
      fireEvent.touchMove(viewport, { touches: [{ clientY: 240 + step * 2 }] })
      scrollGeometry(viewport, direction === 'older' ? 0 : 1400)
      fireEvent.scroll(viewport)
      expect(h.read).toHaveBeenCalledTimes(3)
      expect(h.read.mock.calls.at(-1)![0].cursor).toMatchObject({
        direction: direction === 'older' ? 'before' : 'after',
        messageId: direction === 'older' ? 'm20' : 'm199',
      })
      fireEvent.touchEnd(viewport)
    }
  )

  test.each(['navigateMessage', 'openSearch', 'viewThread'] as const)(
    '%s reports a failed controller read to its caller',
    async (method) => {
      render(<Host />)
      await waitFor(() => expect(h.firstReady).toBe(true))
      h.read.mockRejectedValueOnce(new Error('Target is missing'))
      await act(async () => {
        expect(await h.navigation?.[method]('missing')).toBe(false)
      })
    }
  )
  test('reports a superseded navigation as false while the newest search succeeds', async () => {
    render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    let finish!: (result: SessionTranscriptPage) => void
    h.read.mockImplementationOnce(
      () =>
        new Promise<SessionTranscriptPage>((resolve) => {
          finish = resolve
        })
    )
    let pending!: Promise<boolean>
    act(() => {
      pending = h.navigation!.navigateMessage('m1')
    })
    const firstRequest = h.read.mock.calls.at(-1)![0] as SessionTranscriptRequest
    await act(async () => {
      expect(await h.navigation?.openSearch('m75')).toBe(true)
      finish(page(firstRequest))
      expect(await pending).toBe(false)
    })
  })
  test('loads an older page from an initial scrollbar drag and ignores layout feedback after release', async () => {
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const scroller = view.getByTestId('virtuoso')
    scrollGeometry(scroller, 400)
    pointerEvent(scroller, 'pointerdown')
    scroller.scrollTop = 100
    fireEvent.scroll(scroller)
    await waitFor(() => expect(h.read).toHaveBeenCalledTimes(2))
    expect(h.read.mock.calls[1][0].cursor).toMatchObject({ direction: 'before', messageId: 'm120' })
    pointerEvent(document, 'pointerup')
    await waitFor(() =>
      expect(view.container.querySelector('[data-session-view]')?.getAttribute('aria-busy')).toBe('false')
    )
    scroller.scrollTop = 0
    fireEvent.scroll(scroller)
    act(() => h.starts.at(-1)?.())
    expect(h.read).toHaveBeenCalledTimes(2)
  })
  test('acknowledges preserve layout using the geometry from its final stable frame', async () => {
    const listRef = createRef<MessageListRef>()
    const view = render(<Host listRef={listRef} captureAnchor={() => listRef.current?.captureAnchor() ?? null} />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const viewport = view.getByTestId('virtuoso')
    h.measuredHeight = 2000
    h.rowTop = 100
    scrollGeometry(viewport, 200)
    const captured = listRef.current!.captureAnchor()!
    const pendingFrames = new Map<number, FrameRequestCallback>()
    let sequence = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrames.set(++sequence, callback)
      return sequence
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => pendingFrames.delete(id))
    const frame = () => {
      const callbacks = [...pendingFrames.values()]
      pendingFrames.clear()
      act(() => callbacks.forEach((callback) => callback(performance.now())))
    }
    const controller = h.controller!
    const acknowledge = vi.spyOn(controller, 'acknowledgeLayout')
    const acknowledgedPointOffsets: number[] = []
    const unsubscribe = controller.subscribe(() => {
      if (!controller.getSnapshot().layout && acknowledge.mock.calls.length > acknowledgedPointOffsets.length)
        acknowledgedPointOffsets.push(h.rowTop)
    })
    try {
      await act(async () => {
        await controller.loadOlder()
      })
      const layout = controller.getSnapshot().layout!
      expect(layout.kind).toBe('preserve')
      expect(layout.anchor).toEqual(captured)
      frame()
      frame()
      frame()
      expect(h.rowTop).toBe(100)
      viewport.scrollTop += 12.5
      h.rowTop -= 12.5
      fireEvent.scroll(viewport)
      frame()
      expect(acknowledge).toHaveBeenCalledExactlyOnceWith(layout.requestId)
      expect(acknowledgedPointOffsets).toEqual([captured.offset])
      expect(h.rowTop).toBe(captured.offset - 12.5)
      expect(controller.getSnapshot().layout).toBeNull()
    } finally {
      unsubscribe()
    }
  })

  test('compensates a newly published page during an existing scrollbar drag before yielding', async () => {
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const scroller = view.getByTestId('virtuoso')
    pointerEvent(scroller, 'pointerdown')
    const pendingFrames = new Map<number, FrameRequestCallback>()
    let sequence = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrames.set(++sequence, callback)
      return sequence
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => pendingFrames.delete(id))
    await act(async () => {
      await h.controller!.loadOlder()
    })
    const requestId = h.controller!.getSnapshot().layout!.requestId
    const pageRows = h.controller!.getSnapshot().rows
    scroller.scrollTop += 40
    h.rowTop -= 40
    fireEvent.scroll(scroller)
    expect(h.controller!.getSnapshot().layout).toBeNull()
    expect(h.controller!.getSnapshot().rows).toBe(pageRows)
    expect(h.controller!.getSnapshot().firstWindowReady).toBe(true)
    expect(h.rowTop).toBe(-40)
    expect(h.controller!.acknowledgeLayout(requestId)).toBe(false)
    expect(h.scrollToIndex).not.toHaveBeenCalled()
    expect(h.scrollIntoView).not.toHaveBeenCalled()
    scroller.scrollTop += 25
    h.rowTop -= 25
    fireEvent.scroll(scroller)
    expect(h.rowTop).toBe(-65)
    pointerEvent(document, 'pointerup')
  })

  test('does not treat its own unmounted-target seek as a drag while a pointer remains held', async () => {
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const scroller = view.getByTestId('virtuoso')
    pointerEvent(scroller, 'pointerdown')
    const pendingFrames = new Map<number, FrameRequestCallback>()
    let sequence = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrames.set(++sequence, callback)
      return sequence
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => pendingFrames.delete(id))
    h.tailMounted = false
    view.rerender(<Host />)
    await act(async () => {
      await h.controller!.navigate({ messageId: 'm219' })
    })
    expect(h.scrollIntoView).toHaveBeenCalled()
    const layout = h.controller!.getSnapshot().layout
    expect(layout).not.toBeNull()
    fireEvent.scroll(scroller)
    expect(h.controller!.getSnapshot().layout).toBe(layout)
    pointerEvent(document, 'pointerup')
  })

  test('loads a newer page from a scrollbar drag at the conversation head', async () => {
    const view = render(<Host search="m0" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    const scroller = view.getByTestId('virtuoso')
    scrollGeometry(scroller, 500)
    pointerEvent(scroller, 'pointerdown')
    scroller.scrollTop = 1300
    fireEvent.scroll(scroller)
    await waitFor(() => expect(h.read).toHaveBeenCalledTimes(2))
    expect(h.read.mock.calls[1][0].cursor).toMatchObject({ direction: 'after', messageId: 'm99' })
    pointerEvent(document, 'pointercancel')
  })
  test('search centers one page on the target and aligns that message, including a loaded result', async () => {
    h.rowOffsets.set('m73', 400)
    const view = render(<Host search="m73" />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(h.read.mock.calls[0][0].origin).toEqual({ messageId: 'm73', align: 'center' })
    expect(h.controller!.getSnapshot().rows.map((row) => row.messageId)).toEqual(
      Array.from({ length: 100 }, (_, index) => `m${24 + index}`)
    )
    const target = view.container.querySelector<HTMLElement>('[data-transcript-message="m73"]')!
    expect(target.getBoundingClientRect().top).toBe(0)
    expect(h.scrollBy).toHaveBeenCalledWith({ top: 980, behavior: 'auto' })
    h.rowTop = 580
    h.rowOffsets.set('m75', 200)
    await act(async () => {
      await h.navigation?.openSearch('m75')
    })
    await waitFor(() => expect(h.controller!.getSnapshot().operation).toBeNull())
    expect(h.read.mock.calls.at(-1)?.[0].origin).toEqual({ messageId: 'm75', align: 'center' })
    expect(h.controller!.getSnapshot().rows[0].messageId).toBe('m26')
    expect(
      view.container.querySelector<HTMLElement>('[data-transcript-message="m75"]')!.getBoundingClientRect().top
    ).toBe(0)
  })
  test('minimap aligns a loaded message without reading another body page', async () => {
    const view = render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    h.rowOffsets.set('m120', 300)
    fireEvent.click(view.getByTestId('minimap'))
    await waitFor(() => expect(h.controller!.getSnapshot().operation).toBeNull())
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.controller!.getSnapshot().rows[0].messageId).toBe('m120')
    expect(
      view.container.querySelector<HTMLElement>('[data-transcript-message="m120"]')!.getBoundingClientRect().top
    ).toBe(0)
  })
  test('minimap pagination and edge jumps share the body window', async () => {
    render(<Host />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    act(() => h.minimapProps!.onLoadOlder?.())
    await waitFor(() => expect(h.controller!.getSnapshot().operation).toBeNull())
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.read.mock.calls[1][0]).toMatchObject({ limit: 100, cursor: { direction: 'before', messageId: 'm120' } })
    expect(h.controller!.getSnapshot().rows).toHaveLength(200)
    expect(h.controller!.getSnapshot().rows[0].messageId).toBe('m20')
    expect(h.minimapProps!.anchors[0].messageId).toBe('m20')
    expect(h.minimapProps!.anchors).toHaveLength(100)
    act(() => {
      h.minimapProps!.onEdge?.('head')
    })
    await waitFor(() => expect(h.controller!.getSnapshot().operation).toBeNull())
    expect(h.read.mock.calls.at(-1)![0]).toMatchObject({ origin: 'head', limit: 100 })
    expect(h.controller!.getSnapshot().rows).toHaveLength(100)
    expect(h.minimapProps!.anchors[0].messageId).toBe('m0')
    expect(h.minimapProps!.anchors).toHaveLength(50)
  })
  test('keeps view-thread navigation separate from edge jumps and cleans up its owner', async () => {
    const listRef = createRef<MessageListRef>()
    const view = render(<Host listRef={listRef} />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    await act(async () => {
      await h.navigation?.viewThread('archived')
    })
    expect(h.read.mock.calls.at(-1)?.[0].origin).toEqual({ threadId: 'archived', edge: 'head', align: 'center' })
    act(() => listRef.current?.scrollToTop())
    await waitFor(() => expect(h.read.mock.calls.at(-1)?.[0].origin).toBe('head'))
    view.unmount()
    expect(h.navigation).toBeNull()
  })
  test('preserves picture read-only actions', async () => {
    render(<Host read={{ ...header, header: { ...header.header, type: 'picture' } }} />)
    await waitFor(() => expect(h.firstReady).toBe(true))
    expect(h.bodyModes.every((item) => item.readOnly)).toBe(true)
  })
})
