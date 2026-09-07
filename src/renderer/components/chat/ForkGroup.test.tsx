// @vitest-environment jsdom

import { IDLE_SESSION_LOCK_STATE, type SessionLockState } from '@chatbox/core/session/action-gates'
import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Message, Session } from '@shared/types'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { deleteForkMock, isSmallScreenMock, switchForkMock, switchForkToMock, toastMock } = vi.hoisted(() => ({
  deleteForkMock: vi.fn(),
  isSmallScreenMock: vi.fn(() => false),
  switchForkMock: vi.fn(),
  switchForkToMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: isSmallScreenMock }))
vi.mock('@/stores/session/forks', () => ({
  deleteFork: deleteForkMock,
  switchFork: switchForkMock,
  switchForkTo: switchForkToMock,
}))
vi.mock('@/stores/toastActions', () => ({ add: toastMock }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
  }),
}))
vi.mock('../ActionMenu', () => ({
  default: ({
    children,
    items,
  }: {
    children: React.ReactNode
    items: Array<{ divider?: boolean; text?: string; disabled?: boolean; onClick?: () => void }>
  }) => (
    <div>
      {children}
      {items
        .filter((item) => !item.divider)
        .map((item) => (
          <button key={item.text} type="button" disabled={item.disabled} onClick={item.onClick}>
            {item.text}
          </button>
        ))}
    </div>
  ),
}))
vi.mock('./Message', () => ({
  default: ({ msg }: { msg: Message }) => <div data-testid={`message-${msg.id}`}>{msg.id}</div>,
}))

import ForkGroup from './ForkGroup'

type ForkEntry = NonNullable<Session['messageForksHash']>[string]

function message(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    role: 'assistant',
    contentParts: [{ type: 'text', text: id }],
    ...overrides,
  }
}

function locks(overrides: Partial<SessionLockState> = {}): SessionLockState {
  return { ...IDLE_SESSION_LOCK_STATE, ...overrides }
}

function generationLocks(): SessionLockState {
  return locks({ generatingReplyCount: 2, anyReplyGenerating: true })
}

function renderGroup(
  forks: ForkEntry,
  sessionLocks: SessionLockState = locks(),
  sessionType: 'chat' | 'picture' = 'chat',
  sessionMode: 'chat' | 'work' = 'chat'
) {
  return render(
    <MantineProvider>
      <ForkGroup
        sessionId="session-1"
        sessionType={sessionType}
        msgId="user-1"
        forks={forks}
        sessionLocks={sessionLocks}
        sessionMode={sessionMode}
      />
    </MantineProvider>
  )
}

describe('ForkGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isSmallScreenMock.mockReturnValue(false)
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

  test('exposes stable test IDs for fork navigation', () => {
    renderGroup({
      position: 1,
      lists: [
        { id: 'first', messages: [] },
        { id: 'current', messages: [] },
      ],
      createdAt: 1,
    })

    expect(screen.getByTestId(TestId.message.forkGroup).getAttribute('data-message-id')).toBe('user-1')
    expect(screen.getByTestId(TestId.message.forkPrevious)).toBeTruthy()
    expect(screen.getByTestId(TestId.message.forkCounter).textContent).toBe('2 / 2')
    expect(screen.getByTestId(TestId.message.forkNext)).toBeTruthy()
  })

  test('keeps branch navigation but removes fork deletion for legacy picture sessions', () => {
    renderGroup(
      {
        position: 0,
        lists: [
          { id: 'current', messages: [] },
          { id: 'alternative', messages: [] },
        ],
        createdAt: 1,
      },
      locks(),
      'picture'
    )

    expect(screen.queryByRole('button', { name: 'delete' })).toBeNull()
    fireEvent.click(screen.getByTestId(TestId.message.forkNext))
    expect(switchForkMock).toHaveBeenCalledWith('session-1', 'user-1', 'next')
  })

  test('scopes repeated fork navigation IDs by message ID', () => {
    const forks: ForkEntry = {
      position: 0,
      lists: [
        { id: 'current', messages: [] },
        { id: 'alternative', messages: [] },
      ],
      createdAt: 1,
    }

    render(
      <MantineProvider>
        <ForkGroup
          sessionId="session-1"
          sessionType="chat"
          msgId="message-a"
          forks={forks}
          sessionLocks={IDLE_SESSION_LOCK_STATE}
        />
        <ForkGroup
          sessionId="session-1"
          sessionType="chat"
          msgId="message-b"
          forks={forks}
          sessionLocks={IDLE_SESSION_LOCK_STATE}
        />
      </MantineProvider>
    )

    const groups = screen.getAllByTestId(TestId.message.forkGroup)
    expect(groups).toHaveLength(2)

    const groupA = groups.find((group) => group.getAttribute('data-message-id') === 'message-a')
    const groupB = groups.find((group) => group.getAttribute('data-message-id') === 'message-b')
    expect(groupA).toBeTruthy()
    expect(groupB).toBeTruthy()
    expect(within(groupA!).getByTestId(TestId.message.forkNext)).toBeTruthy()
    expect(within(groupB!).getByTestId(TestId.message.forkPrevious)).toBeTruthy()
  })

  test('keeps saved replies collapsed until the user expands them', () => {
    renderGroup({
      position: 0,
      lists: [
        { id: 'current', messages: [] },
        {
          id: 'alternative',
          messages: [message('alternative-reply'), message('follow-up-user', { role: 'user' })],
        },
      ],
      createdAt: 1,
    })

    expect(screen.queryByTestId('message-alternative-reply')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))

    expect(screen.getByTestId('message-alternative-reply')).toBeTruthy()
    expect(screen.getByText('1 follow-up message')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse other branches' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to this branch' }))

    expect(switchForkToMock).toHaveBeenCalledWith('session-1', 'user-1', 1)
  })

  test('filters empty branches from expanded reply counts', () => {
    renderGroup({
      position: 0,
      lists: [
        { id: 'current', messages: [] },
        { id: 'empty', messages: [] },
        { id: 'alternative', messages: [message('alternative-reply')] },
      ],
      createdAt: 1,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))

    expect(screen.getByTestId('message-alternative-reply')).toBeTruthy()
    expect(screen.queryByText('Showing 1 of 1 other replies')).toBeNull()
  })

  test('reveals a newly generating inactive reply without expanding every branch', () => {
    renderGroup(
      {
        position: 0,
        lists: [
          { id: 'current', messages: [] },
          { id: 'older', messages: [message('older-reply')] },
          {
            id: 'generating',
            messages: [message('generating-reply', { generating: true })],
          },
        ],
        createdAt: 1,
      },
      generationLocks()
    )

    expect(screen.queryByTestId('message-older-reply')).toBeNull()
    expect(screen.getByTestId('message-generating-reply')).toBeTruthy()
    expect(screen.getByText('Showing 1 of 2 other replies')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Expand view' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse other branches' })).toBeTruthy()
  })

  test('previews a Save & Resend branch as its question/answer pair', () => {
    renderGroup({
      position: 0,
      lists: [
        { id: 'current', messages: [] },
        {
          id: 'resend-branch',
          messages: [
            message('old-prompt', { role: 'user' }),
            message('old-reply'),
            message('later-question', { role: 'user' }),
          ],
        },
      ],
      createdAt: 1,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))

    // The head is the original prompt (what tells branches apart), previewed
    // together with the reply it actually received; the label says Branch,
    // not Reply, and the remaining messages stay a count.
    expect(screen.getByText('Branch 2')).toBeTruthy()
    expect(screen.getByTestId('message-old-prompt')).toBeTruthy()
    expect(screen.getByTestId('message-old-reply')).toBeTruthy()
    expect(screen.queryByTestId('message-later-question')).toBeNull()
    expect(screen.getByText('1 follow-up message')).toBeTruthy()
  })

  test('shows a prompt-only branch instead of dropping it from the preview', () => {
    renderGroup({
      position: 0,
      lists: [
        { id: 'current', messages: [] },
        { id: 'unanswered', messages: [message('old-prompt', { role: 'user' })] },
      ],
      createdAt: 1,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))

    expect(screen.getByText('Branch 2')).toBeTruthy()
    expect(screen.getByTestId('message-old-prompt')).toBeTruthy()
    expect(screen.queryByText(/follow-up/)).toBeNull()
  })

  test('renders live follow-up candidates in a revealed branch and keeps them after they finish', () => {
    const branchWithStreamingTail = (generating: boolean): ForkEntry => ({
      position: 0,
      lists: [
        { id: 'current', messages: [] },
        {
          id: 'saved',
          messages: [
            message('saved-first-reply'),
            message('saved-question', { role: 'user' }),
            message('saved-candidate-a', { generating }),
            message('saved-candidate-b', { generating }),
          ],
        },
      ],
      createdAt: 1,
    })
    const group = (forks: ForkEntry) => (
      <MantineProvider>
        <ForkGroup
          sessionId="session-1"
          sessionType="chat"
          msgId="user-1"
          forks={forks}
          sessionLocks={generationLocks()}
        />
      </MantineProvider>
    )
    const { rerender } = render(group(branchWithStreamingTail(true)))

    // The live tail reveals the branch; both streaming candidates render below
    // the first reply, and the follow-up count only covers hidden messages.
    expect(screen.getByTestId('message-saved-first-reply')).toBeTruthy()
    expect(screen.getByTestId('message-saved-candidate-a')).toBeTruthy()
    expect(screen.getByTestId('message-saved-candidate-b')).toBeTruthy()
    expect(screen.getByText('1 follow-up message')).toBeTruthy()

    // Finished candidates stay visible (sticky, like the branch reveal itself).
    rerender(group(branchWithStreamingTail(false)))
    expect(screen.getByTestId('message-saved-candidate-a')).toBeTruthy()
    expect(screen.getByTestId('message-saved-candidate-b')).toBeTruthy()
    expect(screen.getByText('1 follow-up message')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse other branches' }))
    expect(screen.queryByTestId('message-saved-candidate-a')).toBeNull()
    expect(screen.queryByTestId('message-saved-first-reply')).toBeNull()
  })

  test('shows alternative replies newest-first so a generating reply stays on top', () => {
    renderGroup(
      {
        position: 0,
        lists: [
          { id: 'current', messages: [] },
          { id: 'older', messages: [message('older-reply')] },
          {
            id: 'generating',
            messages: [message('generating-reply', { generating: true })],
          },
        ],
        createdAt: 1,
      },
      generationLocks()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }))

    const replyLabels = screen.getAllByText(/Reply \d+/).map((node) => node.textContent)
    expect(replyLabels).toEqual(['Reply 3', 'Reply 2'])

    const messages = screen.getAllByTestId(/^message-(generating-reply|older-reply)$/)
    expect(messages.map((node) => node.getAttribute('data-testid'))).toEqual([
      'message-generating-reply',
      'message-older-reply',
    ])
  })

  test('lets chat mode switch branches while replies stream but keeps deletion locked', () => {
    renderGroup(
      {
        position: 0,
        lists: [
          { id: 'current', messages: [] },
          {
            id: 'alternative',
            messages: [message('alternative-reply', { generating: true })],
          },
        ],
        createdAt: 1,
      },
      generationLocks()
    )

    fireEvent.click(screen.getByTestId(TestId.message.forkNext))
    expect(switchForkMock).toHaveBeenCalledWith('session-1', 'user-1', 'next')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to this branch' }))
    expect(switchForkToMock).toHaveBeenCalledWith('session-1', 'user-1', 1)

    // Deleting a branch may kill the live stream — locked in every mode.
    expect((screen.getByRole('button', { name: 'delete' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('keeps work mode branch switching locked during generation and explains why', async () => {
    renderGroup(
      {
        position: 0,
        lists: [
          { id: 'current', messages: [] },
          {
            id: 'alternative',
            messages: [message('alternative-reply', { generating: true })],
          },
        ],
        createdAt: 1,
      },
      generationLocks(),
      'chat',
      'work'
    )

    fireEvent.click(screen.getAllByLabelText('Wait for the current replies to finish')[0])

    expect(switchForkMock).not.toHaveBeenCalled()
    // The lock notice loads toastActions lazily, so the call lands a tick later.
    await vi.waitFor(() => expect(toastMock).toHaveBeenCalledWith('Wait for the current replies to finish', 2500))
    expect((screen.getByRole('button', { name: 'Switch to this branch' }) as HTMLButtonElement).disabled).toBe(true)
    expect(switchForkToMock).not.toHaveBeenCalled()
  })

  test('explains the disabled direct switch when tapped on mobile (work mode)', async () => {
    isSmallScreenMock.mockReturnValue(true)
    renderGroup(
      {
        position: 0,
        lists: [
          { id: 'current', messages: [] },
          {
            id: 'alternative',
            messages: [message('alternative-reply', { generating: true })],
          },
        ],
        createdAt: 1,
      },
      generationLocks(),
      'chat',
      'work'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch to this branch' }))

    expect(switchForkToMock).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(toastMock).toHaveBeenCalledWith('Wait for the current replies to finish', 2500))
  })

  test('blocks branch switching while compaction is running and explains why', async () => {
    renderGroup(
      {
        position: 0,
        lists: [
          { id: 'current', messages: [] },
          { id: 'alternative', messages: [message('alternative-reply')] },
        ],
        createdAt: 1,
      },
      locks({ compactionRunning: true })
    )

    fireEvent.click(screen.getAllByLabelText('Wait for compaction to finish')[0])

    expect(switchForkMock).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(toastMock).toHaveBeenCalledWith('Wait for compaction to finish', 2500))
  })
})
