// @vitest-environment jsdom

import type { Message } from '@shared/types'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { type ComponentType, type ReactNode, Suspense } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { InputBoxPayload } from '@/components/InputBox/InputBox'

const h = vi.hoisted(() => ({
  sessionId: 'session-a',
  lastUserMessageId: 'previous-message',
  topMode: false,
  onSubmit: null as ((payload: InputBoxPayload) => Promise<void>) | null,
  onReady: null as (() => void) | null,
  submit: vi.fn(),
  scroll: vi.fn(),
  markNew: vi.fn(),
  /** What the list reports when a send captures the follow intent; null means the user is reading history. */
  intent: null as { following: boolean } | null,
  capture: vi.fn(),
}))

vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')),
  createFileRoute: () => (options: unknown) => ({ options, useParams: () => ({ sessionId: h.sessionId }) }),
  useNavigate: () => vi.fn(),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (text: string) => text }) }))
vi.mock('@mantine/core', () => ({
  Box: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: () => null,
  Loader: () => null,
}))
vi.mock('zustand', () => ({ useStore: () => vi.fn() }))
vi.mock('@/analytics/jk-events', () => ({ JK_PAGE_NAMES: {} }))
vi.mock('@/app/renderer-application', () => ({ rendererApplication: { sessions: {} } }))
vi.mock('@/components/chat/MessageList', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef(function MessageList(_props: unknown, ref) {
      const sessionId = h.sessionId
      useImperativeHandle(
        ref,
        () => ({
          scrollToBottom: () => h.scroll(sessionId),
          setIsNewMessage: h.markNew,
          captureSendFollow: () => {
            h.capture(sessionId)
            const intent = h.intent
            return intent ? () => intent.following : null
          },
        }),
        [sessionId]
      )
      return <div data-testid="message-list">{sessionId}</div>
    }),
  }
})
vi.mock('@/components/InputBox/InputBox', () => ({
  default: ({ onSubmit }: { onSubmit: (payload: InputBoxPayload) => Promise<void> }) => {
    h.onSubmit = onSubmit
    return null
  },
}))
vi.mock('@/components/chat/MessageLongPressHint', () => ({ MessageLongPressHint: () => null }))
vi.mock('@/components/common/ChatboxWelcomeCard', () => ({ ChatboxWelcomeCard: () => null }))
vi.mock('@/components/common/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/layout/contentColumn', () => ({
  contentColumnContainerClassName: () => '',
  paddedContentColumnClassName: () => '',
}))
vi.mock('@/components/layout/Header', () => ({ default: () => null }))
vi.mock('@/components/layout/Page', () => ({ default: () => null }))
vi.mock('@/components/session/SessionRecoveryDetails', () => ({ SessionRecoveryDetails: () => null }))
vi.mock('@/components/session/SessionSheet', () => ({ SessionSheet: () => null }))
vi.mock('@/components/session/SessionSidePanel', () => ({ closeSessionPanel: vi.fn(), SessionSidePanel: () => null }))
vi.mock('@/hooks/useGenerationStop', () => ({ useGenerationStop: () => ({}) }))
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [] }) }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => true }))
vi.mock('@/hooks/useSessionPresentation', () => ({
  useSessionPresentation: () => ({
    header: { id: h.sessionId, type: 'chat' },
    read: { summary: { lastUserMessageId: h.lastUserMessageId } },
    isFetching: false,
    isError: false,
  }),
  useSessionTranscript: () => ({ rows: [], firstWindowReady: true }),
}))
vi.mock('@/hooks/useVersion', () => ({ default: () => ({ isExceeded: false, isExceededResolved: true }) }))
vi.mock('@/packages/initial_data', () => ({ defaultSessionsForCN: [], defaultSessionsForEN: [] }))
vi.mock('@/packages/remote', () => ({ recordCopilotUsage: vi.fn() }))
vi.mock('@/packages/session-startup-recovery', () => ({
  sessionStartupRecovery: {},
  useSessionStartupGuard: vi.fn(),
  useSessionStartupLoadTarget: (id: string) => id,
  useSessionStartupQueryFailure: vi.fn(),
}))
vi.mock('@/platform', () => ({ default: { type: 'mobile' } }))
vi.mock('@/presentation/session/session-archive-notification', () => ({ showSessionArchiveUndo: vi.fn() }))
vi.mock('@/stores/authInfoStore', () => ({ useAuthInfoStore: () => false }))
vi.mock('@/stores/defaultChatModel', () => ({ applyChatboxLicenseDefaultModelToSession: vi.fn() }))
vi.mock('@/stores/lastUsedModelStore', () => ({ lastUsedModelStore: {} }))
vi.mock('@/stores/session/agent-mode', () => ({ useSessionAgentMode: () => ({ value: 'off' }) }))
vi.mock('@/stores/session/crud', () => ({ switchCurrentSession: vi.fn() }))
vi.mock('@/stores/session/messages', () => ({ submitNewUserMessage: h.submit }))
vi.mock('@/stores/session/threads', () => ({ startNewThread: vi.fn() }))
vi.mock('@/stores/session-search-target', () => ({
  clearSessionSearchTarget: vi.fn(),
  getSessionSearchTarget: () => null,
}))
vi.mock('@/stores/sessionActivityStore', () => ({ clearSessionActivity: vi.fn(), setOnScreenSession: vi.fn() }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (select: (settings: { autoScrollNewMessagesToTop: boolean }) => unknown) =>
    select({ autoScrollNewMessagesToTop: h.topMode }),
}))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/stores/uiStore', () => ({ uiStore: {}, useUIStore: () => false }))
vi.mock('@/utils/homeWelcomeCard', () => ({ getHomeWelcomeCardMode: () => 'none' }))

import { Route } from './$sessionId'

const SessionRoute = Route.options.component as ComponentType
const message: Message = { id: 'new-message', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] }
function Page() {
  return (
    <Suspense>
      <SessionRoute />
    </Suspense>
  )
}

async function renderRoute() {
  const view = render(<Page />)
  await waitFor(() => expect(h.onSubmit).not.toBeNull())
  return { rerender: () => view.rerender(<Page />) }
}

describe('session send scroll intent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.sessionId = 'session-a'
    h.lastUserMessageId = 'previous-message'
    h.topMode = false
    h.onSubmit = null
    h.onReady = null
    h.intent = { following: true }
    h.submit.mockImplementation((_sessionId: string, params: { onUserMessageReady?: () => void }) => {
      h.onReady = params.onUserMessageReady ?? null
      return Promise.resolve()
    })
  })
  afterEach(cleanup)

  test('waits for the submitted user message to commit before scrolling', async () => {
    const view = await renderRoute()
    const releaseDraft = vi.fn()
    await act(async () => h.onSubmit?.({ constructedMessage: message, onUserMessageReady: releaseDraft }))
    act(() => h.onReady?.())
    expect(releaseDraft).toHaveBeenCalledOnce()
    expect(h.scroll).not.toHaveBeenCalled()

    h.lastUserMessageId = message.id
    view.rerender()
    expect(h.scroll).toHaveBeenCalledExactlyOnceWith('session-a')
    view.rerender()
    expect(h.scroll).toHaveBeenCalledOnce()
  })

  test('scrolls when the mobile callback follows the committed header', async () => {
    const view = await renderRoute()
    await act(async () => h.onSubmit?.({ constructedMessage: message }))
    h.lastUserMessageId = message.id
    view.rerender()
    expect(h.scroll).not.toHaveBeenCalled()
    act(() => h.onReady?.())
    expect(h.scroll).toHaveBeenCalledExactlyOnceWith('session-a')
  })

  test('does not follow unrelated commits when the send was blocked', async () => {
    const view = await renderRoute()
    await act(async () => h.onSubmit?.({ constructedMessage: message }))
    h.lastUserMessageId = 'another-message'
    view.rerender()
    expect(h.scroll).not.toHaveBeenCalled()
  })

  test('preserves the start-of-message preference', async () => {
    h.topMode = true
    const view = await renderRoute()
    await act(async () => h.onSubmit?.({ constructedMessage: message }))
    act(() => h.onReady?.())
    h.lastUserMessageId = message.id
    view.rerender()
    expect(h.markNew).toHaveBeenCalledWith(true)
    expect(h.capture).not.toHaveBeenCalled()
    expect(h.scroll).not.toHaveBeenCalled()
  })

  test('ignores a send callback after switching to another conversation', async () => {
    const view = await renderRoute()
    await act(async () => h.onSubmit?.({ constructedMessage: message }))
    const oldReady = h.onReady
    h.sessionId = 'session-b'
    h.lastUserMessageId = message.id
    view.rerender()
    act(() => oldReady?.())
    expect(h.scroll).not.toHaveBeenCalled()
  })

  test('drops a pending intent when the conversation unmounts before commit', async () => {
    const view = await renderRoute()
    await act(async () => h.onSubmit?.({ constructedMessage: message }))
    act(() => h.onReady?.())
    h.sessionId = 'session-b'
    view.rerender()
    h.sessionId = 'session-a'
    h.lastUserMessageId = message.id
    view.rerender()
    expect(h.scroll).not.toHaveBeenCalled()
  })

  test('keeps the reading position when the send started in history', async () => {
    h.intent = null
    const view = await renderRoute()
    await act(async () => h.onSubmit?.({ constructedMessage: message }))
    act(() => h.onReady?.())
    h.lastUserMessageId = message.id
    view.rerender()
    expect(h.capture).toHaveBeenCalledOnce()
    expect(h.scroll).not.toHaveBeenCalled()
  })

  test('reads the intent before the send awaits, not from the list it commits into', async () => {
    let finish!: () => void
    h.submit.mockImplementationOnce((_sessionId: string, params: { onUserMessageReady?: () => void }) => {
      h.onReady = params.onUserMessageReady ?? null
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    const view = await renderRoute()
    let sent!: Promise<void> | undefined
    act(() => {
      sent = h.onSubmit?.({ constructedMessage: message })
    })
    expect(h.capture).toHaveBeenCalledOnce()
    // A later list reset (for example a window rebase pausing follow) is not the user's intent.
    h.intent = null
    act(() => h.onReady?.())
    h.lastUserMessageId = message.id
    view.rerender()
    expect(h.scroll).toHaveBeenCalledExactlyOnceWith('session-a')
    await act(async () => {
      finish()
      await sent
    })
    expect(h.capture).toHaveBeenCalledOnce()
  })

  test('does not return to the bottom when the user scrolls away before the message commits', async () => {
    const intent = { following: true }
    h.intent = intent
    const view = await renderRoute()
    await act(async () => h.onSubmit?.({ constructedMessage: message }))
    act(() => h.onReady?.())
    intent.following = false
    h.lastUserMessageId = message.id
    view.rerender()
    expect(h.scroll).not.toHaveBeenCalled()
  })
})
