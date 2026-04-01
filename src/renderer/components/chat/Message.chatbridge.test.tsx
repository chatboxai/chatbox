/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { createChatBridgeChessRuntimeSnapshot, writeChatBridgeDegradedCompletionValues } from '@shared/chatbridge'
import type { Message } from '@shared/types'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { modifyMessage } from '@/stores/sessionActions'
import MessageComponent from './Message'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}))

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      userAvatarKey: '',
      showMessageTimestamp: false,
      showModelName: false,
      showTokenCount: false,
      showWordCount: false,
      showTokenUsed: false,
      showFirstTokenLatency: false,
      enableMarkdownRendering: true,
      enableLaTeXRendering: false,
      enableMermaidRendering: false,
      autoPreviewArtifacts: false,
      autoCollapseCodeBlock: false,
    }),
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setQuote: vi.fn(),
    }),
}))

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    exporter: {
      exportImageFile: vi.fn(),
      exportByUrl: vi.fn(),
    },
    appLog: vi.fn(async () => undefined),
  },
}))

vi.mock('@/stores/chatStore', () => ({
  getSession: vi.fn(async () => null),
}))

vi.mock('@/modals/Settings', () => ({
  navigateToSettings: vi.fn(),
}))

vi.mock('@/packages/navigator', () => ({
  copyToClipboard: vi.fn(),
}))

vi.mock('@/stores/sessionActions', () => ({
  generateMore: vi.fn(),
  getMessageThreadContext: vi.fn(async () => []),
  modifyMessage: vi.fn(),
  regenerateInNewFork: vi.fn(),
  removeMessage: vi.fn(),
}))

vi.mock('@/stores/toastActions', () => ({
  add: vi.fn(),
}))

describe('Message chatbridge rendering', () => {
  beforeEach(() => {
    vi.mocked(modifyMessage).mockClear()
  })

  it('renders an app-aware content part through the chat timeline without crashing', () => {
    const msg: Message = {
      id: 'assistant-app-1',
      role: 'assistant',
      contentParts: [
        {
          type: 'app',
          appId: 'chess-1',
          appName: 'Chess',
          appInstanceId: 'chess-instance-1',
          lifecycle: 'active',
          title: 'Chess shell',
          description: 'The host keeps the chess runtime in the thread.',
          fallbackTitle: 'Fallback',
          fallbackText: 'Recover in place.',
        },
      ],
      timestamp: Date.now(),
    }

    render(
      <MantineProvider>
        <MessageComponent sessionId="session-1" sessionType="chat" msg={msg} buttonGroup="none" assistantAvatarKey="" />
      </MantineProvider>
    )

    expect(screen.getByText('Chess shell')).toBeTruthy()
    expect(screen.getAllByText('White to move').length).toBeGreaterThan(0)
    expect(screen.getByText('The host keeps the chess runtime in the thread.')).toBeTruthy()
  })

  it('persists a legal chess move through the existing message update path', () => {
    const snapshot = createChatBridgeChessRuntimeSnapshot()
    const msg: Message = {
      id: 'assistant-chess-runtime-1',
      role: 'assistant',
      contentParts: [
        {
          type: 'app',
          appId: 'chess',
          appName: 'Chess',
          appInstanceId: 'chess-instance-2',
          lifecycle: 'active',
          title: 'Chess runtime',
          description:
            'Moves validate inside the board first, then emit a structured host update for the same conversation block.',
          summary: snapshot.boardContext.summary,
          statusText: 'White to move',
          snapshot,
        },
      ],
      timestamp: Date.now(),
    }

    render(
      <MantineProvider>
        <MessageComponent sessionId="session-1" sessionType="chat" msg={msg} buttonGroup="none" assistantAvatarKey="" />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /g1, white knight/i }))
    fireEvent.click(screen.getByRole('button', { name: /f3, legal destination/i }))

    expect(vi.mocked(modifyMessage)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(modifyMessage).mock.calls[0][0]).toBe('session-1')
    expect(vi.mocked(modifyMessage).mock.calls[0][1]).toMatchObject({
      id: 'assistant-chess-runtime-1',
      contentParts: [
        {
          type: 'app',
          appId: 'chess',
          appInstanceId: 'chess-instance-2',
          summary: 'Black to move after Nf3.',
          snapshot: {
            boardContext: {
              sideToMove: 'black',
              lastMove: {
                san: 'Nf3',
                uci: 'g1f3',
              },
            },
          },
        },
      ],
    })
    expect(vi.mocked(modifyMessage).mock.calls[0][2]).toBe(true)
  })

  it('persists degraded recovery acknowledgements through the existing message update path', () => {
    const msg: Message = {
      id: 'assistant-degraded-runtime-1',
      role: 'assistant',
      contentParts: [
        {
          type: 'app',
          appId: 'story-builder',
          appName: 'Story Builder',
          appInstanceId: 'story-builder-instance-1',
          lifecycle: 'error',
          title: 'Story Builder recovery',
          description: 'The host kept the degraded ending inline and bounded to validated state.',
          summary: 'Partial completion stayed bounded inside the host shell.',
          statusText: 'Partial completion',
          fallbackTitle: 'Partial completion fallback',
          fallbackText: 'Only the validated draft fragment remains available until a safe next step happens.',
          values: writeChatBridgeDegradedCompletionValues(undefined, {
            schemaVersion: 1,
            kind: 'partial-completion',
            statusLabel: 'Partial completion',
            title: 'Completion stopped after a partial draft',
            description: 'The host captured the validated fragment and kept recovery in the same message.',
            supportPanel: {
              eyebrow: 'Trust rail',
              title: 'What still holds',
              description: 'Only the validated fragment and host diagnostics remain trusted.',
              items: [
                {
                  label: 'Validated fragment remains visible',
                  description: 'The host can continue from the confirmed partial draft.',
                  tone: 'safe',
                },
              ],
            },
            actions: [
              { id: 'continue-in-chat', label: 'Continue safely', variant: 'primary' },
              { id: 'dismiss-runtime', label: 'Dismiss runtime', variant: 'secondary' },
            ],
          }),
        },
      ],
      timestamp: Date.now(),
    }

    render(
      <MantineProvider>
        <MessageComponent sessionId="session-1" sessionType="chat" msg={msg} buttonGroup="none" assistantAvatarKey="" />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Continue safely' }))

    expect(vi.mocked(modifyMessage)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(modifyMessage).mock.calls[0][0]).toBe('session-1')
    expect(vi.mocked(modifyMessage).mock.calls[0][1]).toMatchObject({
      id: 'assistant-degraded-runtime-1',
      contentParts: [
        {
          type: 'app',
          appId: 'story-builder',
          appInstanceId: 'story-builder-instance-1',
          statusText: 'Continue safely',
          values: {
            chatbridgeDegradedCompletion: {
              acknowledgement: {
                requestedActionId: 'continue-in-chat',
                statusLabel: 'Continue safely',
              },
            },
          },
        },
      ],
    })
    expect(vi.mocked(modifyMessage).mock.calls[0][2]).toBe(true)
  })
})
