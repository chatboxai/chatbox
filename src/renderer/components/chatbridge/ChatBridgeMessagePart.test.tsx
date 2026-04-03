/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  createChatBridgeChessRuntimeSnapshot,
  writeChatBridgeDegradedCompletionValues,
  type ChatBridgeStoryBuilderState,
} from '@shared/chatbridge'
import type { MessageAppPart } from '@shared/types'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatBridgeMessagePart } from './ChatBridgeMessagePart'

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

vi.mock('@/stores/chatStore', () => ({
  updateSessionWithMessages: vi.fn(),
}))

vi.mock('@/router', () => ({
  router: {
    navigate: vi.fn(),
    state: {
      location: {
        pathname: '/',
        search: {},
      },
    },
  },
}))

function createChessPart(snapshot = createChatBridgeChessRuntimeSnapshot()): MessageAppPart {
  return {
    type: 'app',
    appId: 'chess',
    appName: 'Chess',
    appInstanceId: 'chess-instance-1',
    lifecycle: 'active',
    title: 'Chess runtime',
    description:
      'Moves validate inside the board first, then emit a structured host update for the same conversation block.',
    summary: snapshot.boardContext.summary,
    statusText: 'White to move',
    snapshot,
  }
}

function createDegradedPart(): MessageAppPart {
  return {
    type: 'app',
    appId: 'story-builder',
    appName: 'Story Builder',
    appInstanceId: 'story-builder-1',
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
        { id: 'retry-completion', label: 'Retry completion', variant: 'primary' },
        { id: 'continue-in-chat', label: 'Continue safely', variant: 'secondary' },
      ],
    }),
  }
}

function createStoryBuilderState(mode: ChatBridgeStoryBuilderState['mode']): ChatBridgeStoryBuilderState {
  return {
    schemaVersion: 1,
    mode,
    drive: {
      provider: 'google-drive',
      status: 'connected',
      statusLabel: mode === 'complete' ? 'Drive synced' : 'Drive connected',
      detail:
        mode === 'complete'
          ? 'The completed chapter draft and checkpoint trail are saved in the host-approved Drive folder.'
          : 'Host-issued Drive access is active for the classroom writing folder.',
      connectedAs: 'student.writer@example.edu',
      folderLabel: 'Creative Writing / Chapter 4',
      lastSyncedLabel: mode === 'complete' ? 'Just now' : '2 minutes ago',
    },
    draft: {
      title: 'Storm Lantern',
      chapterLabel: 'Chapter 4',
      summary: 'Mara hides the storm lantern before the flood siren starts and the library doors lock.',
      excerpt:
        'Mara tucked the lantern beneath the library desk and counted the sirens again before she dared to breathe.',
      wordCount: mode === 'complete' ? 1048 : 812,
      saveState: 'saved',
      saveLabel: mode === 'complete' ? 'Final draft saved to Drive' : 'Saved to Drive 2 minutes ago',
      userGoal: 'Finish chapter four and keep the latest checkpoint in Drive.',
    },
    checkpoints: [
      {
        checkpointId: 'draft-42',
        label: mode === 'complete' ? 'Final checkpoint' : 'Checkpoint 42',
        description:
          mode === 'complete'
            ? 'Completed chapter pass with resolved lantern reveal.'
            : 'Latest draft with the lantern reveal and flood siren beat.',
        savedAtLabel: mode === 'complete' ? 'Just now' : '2 minutes ago',
        status: 'latest',
        locationLabel: 'Creative Writing / Chapter 4',
      },
    ],
    callout: {
      eyebrow: 'Host guidance',
      title: mode === 'complete' ? 'Completion stays in-thread' : 'Resume stays explicit',
      description:
        mode === 'complete'
          ? 'The draft handoff, checkpoint trail, and next step remain visible in the host shell.'
          : 'The host can reopen this checkpoint without exposing a raw Drive token to the app runtime.',
    },
    completion:
      mode === 'complete'
        ? {
            title: 'Draft returned to chat',
            description:
              'The host preserved the completed chapter, Drive save, and revision cue for the next conversation turn.',
            handoffLabel: 'Ask for revision notes or continue with chapter five.',
            nextStepLabel: 'Continue the writing session from the final checkpoint if you want another pass.',
          }
        : undefined,
  }
}

function createStoryBuilderPart(lifecycle: MessageAppPart['lifecycle']): MessageAppPart {
  const mode = lifecycle === 'complete' ? 'complete' : lifecycle === 'ready' ? 'resume-ready' : 'active'

  return {
    type: 'app',
    appId: 'story-builder',
    appName: 'Story Builder',
    appInstanceId: 'story-builder-1',
    lifecycle,
    title: 'Story Builder',
    description: 'The host keeps auth, save, resume, and completion visible inside the writing shell.',
    summary: 'Restored the active story draft and preserved the exportable checkpoint.',
    statusText: lifecycle === 'complete' ? 'Complete' : lifecycle === 'ready' ? 'Resume ready' : 'Drafting',
    values: {
      chatbridgeStoryBuilder: createStoryBuilderState(mode),
    },
  }
}

describe('ChatBridgeMessagePart chess runtime', () => {
  it('renders the playable chess board inside the active host shell', () => {
    render(
      <MantineProvider>
        <ChatBridgeMessagePart part={createChessPart()} />
      </MantineProvider>
    )

    expect(screen.getByTestId('chatbridge-shell').getAttribute('data-state')).toBe('active')
    expect(screen.getByRole('button', { name: /g1, white knight/i })).toBeTruthy()
    expect(screen.getByText('Select a piece, then choose a legal destination square.')).toBeTruthy()
  })

  it('emits a structured host update when a legal move is played', () => {
    const onUpdatePart = vi.fn()

    render(
      <MantineProvider>
        <ChatBridgeMessagePart part={createChessPart()} onUpdatePart={onUpdatePart} />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /g1, white knight/i }))
    fireEvent.click(screen.getByRole('button', { name: /f3, legal destination/i }))

    expect(onUpdatePart).toHaveBeenCalledTimes(1)
    expect(onUpdatePart.mock.calls[0][0]).toMatchObject({
      summary: 'Black to move after Nf3.',
      statusText: 'Black to move',
      snapshot: {
        boardContext: {
          sideToMove: 'black',
          lastMove: {
            san: 'Nf3',
            uci: 'g1f3',
          },
        },
      },
    })
  })

  it('renders a compact anchor when the runtime is floated into the session tray', () => {
    render(
      <MantineProvider>
        <ChatBridgeMessagePart
          part={createChessPart()}
          presentation="anchor"
          onOpenFloatingShell={vi.fn()}
          floatingTrayMinimized
        />
      </MantineProvider>
    )

    expect(screen.getByTestId('chatbridge-anchor')).toBeTruthy()
    expect(screen.getByText('Restore app')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /g1, white knight/i })).toBeNull()
  })

  it('keeps the board state stable and emits rejected feedback for an illegal move', () => {
    const onUpdatePart = vi.fn()

    render(
      <MantineProvider>
        <ChatBridgeMessagePart part={createChessPart()} onUpdatePart={onUpdatePart} />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /g1, white knight/i }))
    fireEvent.click(screen.getByRole('button', { name: /g5, empty square/i }))

    expect(onUpdatePart).toHaveBeenCalledTimes(1)
    expect(onUpdatePart.mock.calls[0][0]).toMatchObject({
      snapshot: {
        boardContext: {
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        },
        feedback: {
          kind: 'rejected',
          title: 'Illegal move rejected',
        },
      },
    })
  })
})

describe('ChatBridgeMessagePart degraded recovery', () => {
  it('acknowledges recovery actions inline through the host update path', () => {
    const onUpdatePart = vi.fn()

    render(
      <MantineProvider>
        <ChatBridgeMessagePart part={createDegradedPart()} onUpdatePart={onUpdatePart} />
      </MantineProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry completion' }))

    expect(onUpdatePart).toHaveBeenCalledTimes(1)
    expect(onUpdatePart.mock.calls[0][0]).toMatchObject({
      statusText: 'Retry requested',
      values: {
        chatbridgeDegradedCompletion: {
          acknowledgement: {
            requestedActionId: 'retry-completion',
            statusLabel: 'Retry requested',
          },
        },
      },
    })
  })
})

describe('ChatBridgeMessagePart Story Builder surface', () => {
  it('renders the Story Builder writing desk inside the host shell', () => {
    render(
      <MantineProvider>
        <ChatBridgeMessagePart part={createStoryBuilderPart('active')} />
      </MantineProvider>
    )

    expect(screen.getByTestId('chatbridge-shell').getAttribute('data-state')).toBe('active')
    expect(screen.getByTestId('story-builder-panel')).toBeTruthy()
    expect(screen.getByText('Storm Lantern')).toBeTruthy()
    expect(screen.getByText('Drive connected')).toBeTruthy()
    expect(screen.getByText('Checkpoint 42')).toBeTruthy()
  })

  it('keeps the completion handoff inline for completed Story Builder sessions', () => {
    render(
      <MantineProvider>
        <ChatBridgeMessagePart part={createStoryBuilderPart('complete')} />
      </MantineProvider>
    )

    expect(screen.getByTestId('chatbridge-shell').getAttribute('data-state')).toBe('complete')
    expect(screen.getByText('Completion handoff')).toBeTruthy()
    expect(screen.getByText('Draft returned to chat')).toBeTruthy()
    expect(screen.getByText(/continue with chapter five/i)).toBeTruthy()
  })
})
