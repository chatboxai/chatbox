// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { Message, Session } from '@shared/types'
import { MessageRoleEnum } from '@shared/types'
import { type CSSProperties, createRef, type ReactNode, type UIEventHandler } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render } from '@/test-utils'
import MessageList, { type MessageListRef } from './MessageList'

const virtuosoScrollToIndexMock = vi.hoisted(() => vi.fn())

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
        },
        ref
      ) => {
        React.useImperativeHandle(ref, () => ({
          scrollTo: vi.fn(),
          scrollToIndex: virtuosoScrollToIndexMock,
          getState: vi.fn(),
        }))
        React.useEffect(() => {
          props.atTopStateChange?.(false)
          props.atBottomStateChange?.(true)
        }, [props])
        return (
          <div data-testid="virtuoso" onScroll={props.onScroll} style={props.style}>
            {props.data.map((item, index) => {
              const itemKey =
                item && typeof item === 'object' && 'key' in item && typeof item.key === 'string'
                  ? item.key
                  : `item-${index}`

              return (
                <div data-index={index} key={itemKey}>
                  {props.itemContent(index, item)}
                </div>
              )
            })}
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
  useUIStore: (
    selector: (state: {
      widthFull: boolean
      setMessageListElement: () => void
      setMessageScrolling: () => void
    }) => unknown
  ) =>
    selector({
      widthFull: true,
      setMessageListElement: vi.fn(),
      setMessageScrolling: vi.fn(),
    }),
  // getSessionAgentModeEntry falls back to the legacy per-session mode map.
  uiStore: {
    getState: () => ({
      sessionAgentModeMap: {},
      agentModeSmartSwitchingDefault: false,
      agentModeLastSelected: 'off',
      promptCacheBreakConfirmDismissed: {},
    }),
  },
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
  beforeEach(() => {
    settingsState.hideSystemPromptMessage = false
    isSmallScreenMock.value = false
    messageRenderLog.length = 0
    messageButtonGroupLog.length = 0
    promptCacheDeleteResolversLog.length = 0
    actionMenuItemsLog.length = 0
    virtuosoScrollToIndexMock.mockClear()
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
