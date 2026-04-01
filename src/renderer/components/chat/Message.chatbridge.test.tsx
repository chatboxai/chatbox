/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { createChatBridgeRouteMessagePart } from '@shared/chatbridge'
import type { Message } from '@shared/types'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import MessageComponent from './Message'

const setQuoteMock = vi.fn()

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
      setQuote: setQuoteMock,
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
  it('renders a clarify artifact and prefills the selected follow-up prompt', () => {
    setQuoteMock.mockReset()

    const msg: Message = {
      id: 'assistant-route-clarify',
      role: 'assistant',
      contentParts: [
        createChatBridgeRouteMessagePart({
          schemaVersion: 1,
          kind: 'clarify',
          reasonCode: 'ambiguous-match',
          prompt: 'Help me draft an opening statement for class.',
          summary: 'This request could fit Debate Arena or Story Builder, so the host is asking before launching anything.',
          selectedAppId: 'debate-arena',
          matches: [
            {
              appId: 'debate-arena',
              appName: 'Debate Arena',
              matchedContexts: [],
              matchedTerms: ['draft', 'opening', 'statement'],
              score: 7,
              exactAppMatch: false,
              exactToolMatch: true,
            },
            {
              appId: 'story-builder',
              appName: 'Story Builder',
              matchedContexts: [],
              matchedTerms: ['draft'],
              score: 4,
              exactAppMatch: false,
              exactToolMatch: false,
            },
          ],
        }),
      ],
      timestamp: Date.now(),
    }

    render(
      <MantineProvider>
        <MessageComponent
          sessionId="session-1"
          sessionType="chat"
          msg={msg}
          buttonGroup="none"
          assistantAvatarKey=""
        />
      </MantineProvider>
    )

    expect(screen.getByText('Choose the next step')).toBeTruthy()
    expect(screen.getByText('Your request')).toBeTruthy()
    expect(screen.getByText('Help me draft an opening statement for class.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Debate Arena' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue in chat' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open Debate Arena' }))

    expect(setQuoteMock).toHaveBeenCalledTimes(1)
    expect(setQuoteMock.mock.calls[0][0]).toContain('Use Debate Arena for this request')
    expect(setQuoteMock.mock.calls[0][0]).toContain('Story Builder')
  })

  it('renders a chat-only refusal artifact without forcing an app launch', () => {
    setQuoteMock.mockReset()

    const msg: Message = {
      id: 'assistant-route-refuse',
      role: 'assistant',
      contentParts: [
        createChatBridgeRouteMessagePart({
          schemaVersion: 1,
          kind: 'refuse',
          reasonCode: 'no-confident-match',
          prompt: 'What should I cook for dinner tonight?',
          summary:
            'No reviewed app is a confident fit for this request, so the host will keep helping in chat instead of forcing a launch.',
          matches: [],
        }),
      ],
      timestamp: Date.now(),
    }

    render(
      <MantineProvider>
        <MessageComponent
          sessionId="session-1"
          sessionType="chat"
          msg={msg}
          buttonGroup="none"
          assistantAvatarKey=""
        />
      </MantineProvider>
    )

    expect(screen.getByText('Keep this in chat')).toBeTruthy()
    expect(screen.getByText('Chat only')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue in chat' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Explain why' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Continue in chat' }))

    expect(setQuoteMock).toHaveBeenCalledTimes(1)
    expect(setQuoteMock.mock.calls[0][0]).toContain('What should I cook for dinner tonight?')
  })

  it('renders a degraded app checkpoint and prefills a recovery prompt from its action buttons', () => {
    setQuoteMock.mockReset()

    const msg: Message = {
      id: 'assistant-app-2',
      role: 'assistant',
      contentParts: [
        {
          type: 'app',
          appId: 'story-builder',
          appName: 'Story Builder',
          appInstanceId: 'story-builder-instance-1',
          lifecycle: 'error',
          title: 'Story Builder shell',
          values: {
            chatbridgeUserGoal: 'Keep writing chapter four, then save the draft back to Drive.',
            chatbridgeCompletion: {
              schemaVersion: 1,
              status: 'interrupted',
              reason: 'Drive auth expired before export finished.',
              resumability: {
                resumable: true,
                checkpointId: 'draft-42',
                resumeHint: 'Reconnect Google Drive before resuming export.',
              },
            },
          },
        },
      ],
      timestamp: Date.now(),
    }

    render(
      <MantineProvider>
        <MessageComponent
          sessionId="session-1"
          sessionType="chat"
          msg={msg}
          buttonGroup="none"
          assistantAvatarKey=""
        />
      </MantineProvider>
    )

    expect(screen.getByText('Last user goal')).toBeTruthy()
    expect(screen.getByText('Keep writing chapter four, then save the draft back to Drive.')).toBeTruthy()
    expect(screen.getByText('Host-owned recovery')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume app' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ask follow-up' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Resume app' }))

    expect(setQuoteMock).toHaveBeenCalledTimes(1)
    expect(setQuoteMock.mock.calls[0][0]).toContain('Resume the previous Story Builder session')
    expect(setQuoteMock.mock.calls[0][0]).toContain('Reconnect Google Drive before resuming export.')
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
        <MessageComponent
          sessionId="session-1"
          sessionType="chat"
          msg={msg}
          buttonGroup="none"
          assistantAvatarKey=""
        />
      </MantineProvider>
    )

    expect(screen.getAllByText('Chess shell')).toHaveLength(2)
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('The host keeps the chess runtime in the thread.')).toBeTruthy()
  })

  it('renders a Debate Arena live round inside the host-owned shell', () => {
    const msg: Message = {
      id: 'assistant-debate-active',
      role: 'assistant',
      contentParts: [
        {
          type: 'app',
          appId: 'debate-arena',
          appName: 'Debate Arena',
          appInstanceId: 'debate-instance-active',
          lifecycle: 'active',
          values: {
            chatbridgeDebateArena: {
              schemaVersion: 1,
              phase: 'opening',
              motion: 'Schools should allow structured AI writing support in class.',
              teams: [
                {
                  id: 'team-affirmative',
                  name: 'Team Redwood',
                  stance: 'affirmative',
                  thesis: 'AI helps students revise and improve accessibility.',
                },
                {
                  id: 'team-negative',
                  name: 'Team Blue',
                  stance: 'negative',
                  thesis: 'Students should master first-draft reasoning without AI support.',
                },
              ],
              rubricFocus: ['evidence quality', 'counterargument clarity'],
              roundLabel: 'Round 2',
              currentSpeaker: {
                name: 'Maya',
                teamId: 'team-affirmative',
                roleLabel: 'evidence reply',
              },
              timerLabel: '01:30 left',
              coachNote: 'Ask for one classroom example before conceding the claim.',
              highlights: ['Affirmative tied the claim to revision support for multilingual learners.'],
            },
          },
        },
      ],
      timestamp: Date.now(),
    }

    render(
      <MantineProvider>
        <MessageComponent
          sessionId="session-1"
          sessionType="chat"
          msg={msg}
          buttonGroup="none"
          assistantAvatarKey=""
        />
      </MantineProvider>
    )

    expect(screen.getByTestId('debate-arena-panel')).toBeTruthy()
    expect(screen.getByText('Motion')).toBeTruthy()
    expect(screen.getByText('Schools should allow structured AI writing support in class.')).toBeTruthy()
    expect(screen.getByText('Coach-led round')).toBeTruthy()
    expect(screen.getByText(/Maya for Team Redwood \(Affirmative\), evidence reply/i)).toBeTruthy()
    expect(screen.getByText('01:30 left')).toBeTruthy()
  })

  it('renders a structured Debate Arena result without the generic completion receipt', () => {
    const msg: Message = {
      id: 'assistant-debate-complete',
      role: 'assistant',
      contentParts: [
        {
          type: 'app',
          appId: 'debate-arena',
          appName: 'Debate Arena',
          appInstanceId: 'debate-instance-complete',
          lifecycle: 'complete',
          values: {
            chatbridgeDebateArena: {
              schemaVersion: 1,
              phase: 'complete',
              motion: 'Uniforms improve classroom focus.',
              teams: [
                {
                  id: 'team-affirmative',
                  name: 'Team Cedar',
                  stance: 'affirmative',
                  score: 91,
                },
                {
                  id: 'team-negative',
                  name: 'Team River',
                  stance: 'negative',
                  score: 84,
                },
              ],
              rubricFocus: ['claim support', 'rebuttal discipline'],
              result: {
                winnerTeamId: 'team-affirmative',
                decision:
                  'The affirmative team grounded each claim in classroom evidence and responded to every rebuttal directly.',
                nextStep: 'Write a reflection comparing the strongest rebuttal from each side.',
              },
            },
          },
        },
      ],
      timestamp: Date.now(),
    }

    render(
      <MantineProvider>
        <MessageComponent
          sessionId="session-1"
          sessionType="chat"
          msg={msg}
          buttonGroup="none"
          assistantAvatarKey=""
        />
      </MantineProvider>
    )

    expect(screen.getByText('Structured result')).toBeTruthy()
    expect(screen.getByText('Winner: Team Cedar (Affirmative)')).toBeTruthy()
    expect(screen.getByText(/grounded each claim in classroom evidence/i)).toBeTruthy()
    expect(screen.getByText(/Write a reflection comparing the strongest rebuttal/i)).toBeTruthy()
    expect(screen.queryByText('The app finished inside the host shell')).toBeNull()
  })
})
