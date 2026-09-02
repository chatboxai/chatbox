// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Message, MessageToolCallPart, Session } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/platform', () => ({
  default: { appLog: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/adapters/CurrentGenerationService', () => ({
  currentGenerationService: {
    continuePausedToolCall: vi.fn().mockResolvedValue(undefined),
    stopPausedToolCall: vi.fn().mockResolvedValue(undefined),
    disableToolCallLimitPauseAndContinue: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/stores/approvalAttentionStore', () => ({
  revealPausedStep: vi.fn().mockResolvedValue(undefined),
  usePendingActionBarPulseToken: () => 0,
  pulsePendingActionBar: vi.fn(),
}))

vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))

import { currentGenerationService } from '@/adapters/CurrentGenerationService'
import { pulsePendingActionBar } from '@/stores/approvalAttentionStore'
import PendingActionBar, { PENDING_ACTION_ARMING_MS } from './PendingActionBar'

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

function pausedPart(overrides: Partial<MessageToolCallPart>): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'paused',
    toolCallId: 'tc-1',
    toolName: 'user_exec',
    args: {},
    ...overrides,
  } as MessageToolCallPart
}

function makeSession(
  parts: MessageToolCallPart[],
  { sessionId = 'session-1', messageId = 'msg-1' }: { sessionId?: string; messageId?: string } = {}
): Session {
  const message = { id: messageId, role: 'assistant', contentParts: parts } as unknown as Message
  return { id: sessionId, type: 'chat', name: 'test', messages: [message] } as unknown as Session
}

function renderBar(session: Session) {
  return render(<PendingActionBar session={session} />, {
    wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider>,
  })
}

/** Let the input-protection window elapse so decision clicks register. */
function armBar() {
  vi.advanceTimersByTime(PENDING_ACTION_ARMING_MS)
}

function withForkPosition(session: Session, pivotMessageId: string, position: number): Session {
  return {
    ...session,
    messageForksHash: {
      [pivotMessageId]: {
        position,
        lists: [
          { id: 'fork-0', messages: [] },
          { id: 'fork-1', messages: [] },
        ],
        createdAt: 1,
      },
    },
  }
}

const commandApproval = pausedPart({
  toolCallId: 'tc-cmd',
  pauseReason: { type: 'user_exec_approval', command: 'rm -rf build', workdir: '/repo' },
})

const fileApproval = pausedPart({
  toolCallId: 'tc-file',
  toolName: 'edit_file',
  pauseReason: {
    type: 'file_mutation_approval',
    title: 'Edit config.ts',
    preview: '  const config = {\n- retries: 3,\n+ retries: 5,\n  }',
    stats: { mode: 'edit', edits: 1, addedLines: 1, removedLines: 1 },
  },
})

const limitPause = pausedPart({
  toolCallId: 'tc-limit',
  toolName: 'sandbox_bash',
  pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
})

describe('PendingActionBar', () => {
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

  beforeEach(() => {
    vi.clearAllMocks()
    // Only Date is faked: the arming guard compares timestamps, while real timers
    // keep Mantine and Testing Library behavior untouched.
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('renders nothing without pending interactions', () => {
    renderBar(makeSession([pausedPart({ state: 'result', pauseReason: undefined })]))
    expect(screen.queryByTestId(TestId.toolCall.actionBar)).toBeNull()
  })

  it('shows a command approval and routes Approve/Deny to the generation service', () => {
    renderBar(makeSession([commandApproval]))

    expect(screen.getByText('rm -rf build')).toBeTruthy()
    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledWith('session-1', 'msg-1', 'tc-cmd')

    renderBar(makeSession([fileApproval]))
    armBar()
    fireEvent.click(screen.getAllByTestId(TestId.toolCall.deny)[1])
    expect(currentGenerationService.stopPausedToolCall).toHaveBeenCalledWith('session-1', 'msg-1', 'tc-file')
  })

  it('swallows decision clicks until the decision has been visible for a beat', () => {
    renderBar(makeSession([commandApproval]))

    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).not.toHaveBeenCalled()

    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledTimes(1)
  })

  it('re-arms the click guard when the displayed decision changes', () => {
    const { rerender } = renderBar(makeSession([commandApproval, fileApproval]))

    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledTimes(1)

    // The first item leaving the pending list clears the acting state.
    rerender(<PendingActionBar session={makeSession([fileApproval])} />)
    // A click racing the swap must not act on the item that just took this spot.
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledTimes(1)

    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledTimes(2)
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenLastCalledWith('session-1', 'msg-1', 'tc-file')
  })

  it('advances k/N progress as approvals resolve, holding the episode total steady', () => {
    const { rerender } = renderBar(makeSession([commandApproval, fileApproval]))
    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('1 / 2')

    rerender(<PendingActionBar session={makeSession([fileApproval])} />)
    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('2 / 2')
    // The next decision's content replaced the first one.
    expect(screen.getByText('Edit config.ts')).toBeTruthy()
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('-1')).toBeTruthy()
    expect(screen.queryByText(/retries/)).toBeNull()
    expect(screen.queryByText('rm -rf build')).toBeNull()
  })

  it('treats a new pause reason on the same tool call as the next actionable interaction', () => {
    const escalatedApproval = pausedPart({
      toolCallId: 'tc-cmd',
      pauseReason: {
        type: 'command_escalation_approval',
        command: 'rm -rf build',
        retryOf: 'retry-tc-cmd',
        workdir: '/repo',
        justification: 'The sandbox is unavailable.',
      },
    })
    const { rerender } = renderBar(makeSession([commandApproval]))

    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    rerender(<PendingActionBar session={makeSession([escalatedApproval])} />)

    expect(screen.getByText('Retry with full access')).toBeTruthy()
    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('2 / 2')
    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledTimes(2)
  })

  it('resets progress and transient state when the active thread changes', () => {
    const nextThreadApproval = pausedPart({
      toolCallId: 'tc-next-thread',
      pauseReason: { type: 'user_exec_approval', command: 'pnpm check', workdir: '/repo' },
    })
    const { container, rerender } = renderBar(
      makeSession([commandApproval, fileApproval], { messageId: 'thread-a-root' })
    )

    rerender(<PendingActionBar session={makeSession([fileApproval], { messageId: 'thread-a-root' })} />)
    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('2 / 2')
    expect(container.querySelector('.chatbox-action-resolve-flash')).not.toBeNull()

    rerender(
      <PendingActionBar session={makeSession([nextThreadApproval, fileApproval], { messageId: 'thread-b-root' })} />
    )

    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('1 / 2')
    expect(container.querySelector('.chatbox-action-resolve-flash')).toBeNull()
    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledWith(
      'session-1',
      'thread-b-root',
      'tc-next-thread'
    )
  })

  it('resets progress when switching forks that share the first message', () => {
    const pivotMessageId = 'fork-pivot'
    const branchOne = (parts: MessageToolCallPart[]) =>
      withForkPosition(makeSession(parts, { messageId: pivotMessageId }), pivotMessageId, 0)
    const branchTwoApproval = pausedPart({
      toolCallId: 'tc-fork-two',
      pauseReason: { type: 'user_exec_approval', command: 'pnpm test', workdir: '/repo' },
    })
    const branchTwoFile = pausedPart({ ...fileApproval, toolCallId: 'tc-fork-two-file' })
    const { rerender } = renderBar(branchOne([commandApproval, fileApproval]))

    rerender(<PendingActionBar session={branchOne([fileApproval])} />)
    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('2 / 2')

    rerender(
      <PendingActionBar
        session={withForkPosition(
          makeSession([branchTwoApproval, branchTwoFile], { messageId: pivotMessageId }),
          pivotMessageId,
          1
        )}
      />
    )
    expect(screen.getByTestId(TestId.toolCall.actionBarProgress).textContent).toBe('1 / 2')
    expect(screen.getByText('pnpm test')).toBeTruthy()
  })

  it('removes stale actions immediately when the next thread has no pending interaction', () => {
    const { rerender } = renderBar(makeSession([commandApproval], { messageId: 'thread-a-root' }))

    rerender(
      <PendingActionBar
        session={makeSession([pausedPart({ state: 'result', pauseReason: undefined })], {
          messageId: 'thread-b-root',
        })}
      />
    )

    expect(screen.queryByTestId(TestId.toolCall.actionBar)).toBeNull()
    expect(screen.queryByTestId(TestId.toolCall.approve)).toBeNull()
    expect(currentGenerationService.continuePausedToolCall).not.toHaveBeenCalled()
  })

  it('summarizes a file mutation without exposing the detailed diff', () => {
    renderBar(makeSession([fileApproval]))

    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('-1')).toBeTruthy()
    expect(screen.queryByText('- retries: 3,')).toBeNull()
  })

  it('derives line counts from a legacy file preview without rendering it', () => {
    const legacyFileApproval = pausedPart({
      toolCallId: 'tc-legacy-file',
      toolName: 'edit_file',
      pauseReason: {
        type: 'file_mutation_approval',
        title: 'Edit legacy.ts',
        preview: '# Edit 1\n--- old\nsecret = old\n+++ new\nsecret = new',
      },
    })
    renderBar(makeSession([legacyFileApproval]))

    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('-1')).toBeTruthy()
    expect(screen.queryByText(/secret/)).toBeNull()
  })

  it('pulses when a click misses the buttons, since the input it replaced is gone', () => {
    renderBar(makeSession([commandApproval]))

    fireEvent.click(screen.getByText('rm -rf build'))
    expect(pulsePendingActionBar).toHaveBeenCalledTimes(1)

    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.approve))
    // Acting on the decision is not a missed click.
    expect(pulsePendingActionBar).toHaveBeenCalledTimes(1)
  })

  it('pulses missed clicks for a tool-call-limit pause, which takes over the input too', () => {
    renderBar(makeSession([limitPause]))

    fireEvent.click(screen.getByTestId(TestId.toolCall.actionBar))
    expect(pulsePendingActionBar).toHaveBeenCalledTimes(1)
  })

  it('shows Continue/Stop for a tool-call-limit pause', () => {
    renderBar(makeSession([limitPause]))

    armBar()
    fireEvent.click(screen.getByTestId(TestId.toolCall.continue))
    expect(currentGenerationService.continuePausedToolCall).toHaveBeenCalledWith('session-1', 'msg-1', 'tc-limit')

    fireEvent.click(screen.getByTestId(TestId.toolCall.deny))
    // The first click is still pending, so the second action is ignored.
    expect(currentGenerationService.stopPausedToolCall).not.toHaveBeenCalled()
  })
})
