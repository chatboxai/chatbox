// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { Message, Session } from '@shared/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isSmallScreen: false,
  licenseKey: '',
  navigateToSettings: vi.fn(),
  webSearchProvider: 'build-in' as 'build-in' | 'tavily',
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })
  ),
})

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => mocks.isSmallScreen }))
vi.mock('@/modals/settings-navigation', () => ({ navigateToSettings: mocks.navigateToSettings }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (
    selector: (state: { extension: { webSearch: { provider: 'build-in' | 'tavily' } }; licenseKey: string }) => unknown
  ) =>
    selector({
      extension: { webSearch: { provider: mocks.webSearchProvider } },
      licenseKey: mocks.licenseKey,
    }),
}))

import { hasChatboxSearchSignInError, WebSearchUnavailableBanner } from './WebSearchUnavailableBanner'

function session(id: string, errorCode = 20024): Session {
  return {
    id,
    name: 'Weather',
    type: 'chat',
    picUrl: '',
    messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'error',
            toolCallId: 'search-1',
            toolName: 'web_search',
            args: { query: 'weather' },
            result: { errorCode },
          },
        ],
      },
    ],
    threads: [],
  } as Session
}

function appendMessage(currentSession: Session, message: Message): Session {
  return {
    ...currentSession,
    messages: [...currentSession.messages, message],
  }
}

function conversationMessage(id: string): Message {
  return {
    id,
    role: 'user',
    contentParts: [{ type: 'text', text: 'Try again' }],
  }
}

function syntheticMessage(id: string, flags: Pick<Message, 'isForkMarker' | 'isSummary'>): Message {
  return {
    id,
    role: 'assistant',
    contentParts: [{ type: 'text', text: 'Synthetic context' }],
    ...flags,
  }
}

function sessionAfterConversationContinues(id: string): Session {
  return appendMessage(session(id), conversationMessage(`${id}-follow-up`))
}

function withTrailingAgentLoopParts(currentSession: Session): Session {
  const latestMessage = currentSession.messages[currentSession.messages.length - 1]
  if (!latestMessage) return currentSession
  return {
    ...currentSession,
    messages: [
      ...currentSession.messages.slice(0, -1),
      {
        ...latestMessage,
        contentParts: [
          ...latestMessage.contentParts,
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'time-1',
            toolName: 'get_time',
            args: {},
            result: { time: '10:00' },
          },
          { type: 'text', text: 'I could not search the web, but the agent loop completed.' },
        ],
      },
    ],
  }
}

describe('WebSearchUnavailableBanner', () => {
  beforeEach(() => {
    mocks.isSmallScreen = false
    mocks.licenseKey = ''
    mocks.webSearchProvider = 'build-in'
    mocks.navigateToSettings.mockReset()
  })

  it('finds only the actionable built-in search sign-in error', () => {
    expect(hasChatboxSearchSignInError(session('matching'))).toBe(true)
    expect(hasChatboxSearchSignInError(session('other-error', 20025))).toBe(false)
  })

  it('shows persistent guidance only after the current error card is no longer in the latest conversation message', () => {
    const firstError = withTrailingAgentLoopParts(session('message-sequence'))
    const view = render(
      <MantineProvider>
        <WebSearchUnavailableBanner session={firstError} />
      </MantineProvider>
    )

    expect(screen.queryByRole('status')).toBeNull()

    const afterConversationContinues = appendMessage(firstError, conversationMessage('user-2'))
    view.rerender(
      <MantineProvider>
        <WebSearchUnavailableBanner session={afterConversationContinues} />
      </MantineProvider>
    )
    expect(screen.getByRole('status')).toBeTruthy()

    const repeatedError = appendMessage(afterConversationContinues, session('repeated-error').messages[0])
    view.rerender(
      <MantineProvider>
        <WebSearchUnavailableBanner session={repeatedError} />
      </MantineProvider>
    )
    expect(screen.queryByRole('status')).toBeNull()

    view.rerender(
      <MantineProvider>
        <WebSearchUnavailableBanner session={appendMessage(repeatedError, conversationMessage('user-4'))} />
      </MantineProvider>
    )
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('ignores a trailing fork marker when locating the latest conversation message', () => {
    const currentSession = appendMessage(
      withTrailingAgentLoopParts(session('fork-marker-sequence')),
      syntheticMessage('fork-marker', { isForkMarker: true })
    )
    render(
      <MantineProvider>
        <WebSearchUnavailableBanner session={currentSession} />
      </MantineProvider>
    )

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('ignores a trailing compaction summary when locating the latest conversation message', () => {
    const currentSession = appendMessage(
      withTrailingAgentLoopParts(session('summary-sequence')),
      syntheticMessage('summary', { isSummary: true })
    )
    render(
      <MantineProvider>
        <WebSearchUnavailableBanner session={currentSession} />
      </MantineProvider>
    )

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('ignores a trailing system message when locating the latest conversation message', () => {
    const currentSession = appendMessage(withTrailingAgentLoopParts(session('system-message-sequence')), {
      id: 'system-message',
      role: 'system',
      contentParts: [{ type: 'text', text: 'System context' }],
    })
    render(
      <MantineProvider>
        <WebSearchUnavailableBanner session={currentSession} />
      </MantineProvider>
    )

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps guidance above the composer until it is dismissed for this chat', () => {
    const currentSession = sessionAfterConversationContinues('banner-session')
    const view = render(
      <MantineProvider>
        <WebSearchUnavailableBanner session={currentSession} />
      </MantineProvider>
    )

    expect(screen.getByRole('status')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Chatbox AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Web Search settings' }))
    expect(mocks.navigateToSettings).toHaveBeenNthCalledWith(1)
    expect(mocks.navigateToSettings).toHaveBeenNthCalledWith(2, '/web-search')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('status')).toBeNull()

    view.rerender(
      <MantineProvider>
        <WebSearchUnavailableBanner session={sessionAfterConversationContinues('another-session')} />
      </MantineProvider>
    )
    expect(screen.getByRole('status')).toBeTruthy()

    view.unmount()
    render(
      <MantineProvider>
        <WebSearchUnavailableBanner session={currentSession} />
      </MantineProvider>
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('hides the stale error after a license becomes available', () => {
    mocks.licenseKey = 'license-key'
    render(
      <MantineProvider>
        <WebSearchUnavailableBanner session={sessionAfterConversationContinues('licensed-session')} />
      </MantineProvider>
    )

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('hides the stale sign-in error after changing search providers', () => {
    mocks.webSearchProvider = 'tavily'
    render(
      <MantineProvider>
        <WebSearchUnavailableBanner session={sessionAfterConversationContinues('different-provider-session')} />
      </MantineProvider>
    )

    expect(screen.queryByRole('status')).toBeNull()
  })
})
