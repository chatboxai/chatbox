import { describe, expect, it } from 'vitest'
import type { Message, Session } from '../types'
import {
  assertSessionActionAllowed,
  deriveSessionLockState,
  getSessionActionGate,
  getSubmitAvailability,
  IDLE_SESSION_LOCK_STATE,
  isGenerationLocked,
  SessionActionBlockedError,
  type SessionLockState,
  shouldShowConcurrentReplyStop,
} from './action-gates'

function message(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'message-id',
    role: overrides.role ?? 'assistant',
    contentParts: overrides.contentParts ?? [],
    ...overrides,
  }
}

function locks(overrides: Partial<SessionLockState>): SessionLockState {
  return { ...IDLE_SESSION_LOCK_STATE, ...overrides }
}

describe('deriveSessionLockState', () => {
  it('derives generating counts, the placeholder window, and pause state from the session', () => {
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [
        message({ id: 'user', role: 'user' }),
        message({ id: 'placeholder', generating: true }),
        message({ id: 'streaming', generating: true }),
        message({
          id: 'paused',
          contentParts: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'run_command',
              state: 'paused',
              pauseReason: { type: 'user_exec_approval', command: 'ls' },
            },
          ],
        }),
      ],
    }

    const state = deriveSessionLockState(session, {
      compactionRunning: true,
      activeGenerationMessageIds: new Set(['streaming']),
    })

    expect(state.generatingReplyCount).toBe(1)
    expect(state.anyReplyGenerating).toBe(true)
    expect(state.compactionRunning).toBe(true)
    expect(state.awaitingPauseDecision).toBe(true)
    expect(isGenerationLocked(state)).toBe(true)
  })

  it('locks the composer on a tool-call-limit pause, not just on approvals', () => {
    const session: Session = {
      id: 'session-limit',
      name: 'Session',
      messages: [
        message({
          id: 'paused',
          // A limit pause is persisted with generating: false, so this lock is the
          // only thing keeping a send from starting a competing generation.
          generating: false,
          contentParts: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'sandbox_bash',
              state: 'paused',
              pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
            },
          ],
        }),
      ],
    }

    const state = deriveSessionLockState(session)

    expect(state.awaitingPauseDecision).toBe(true)
    expect(state.anyReplyGenerating).toBe(false)
    expect(getSessionActionGate('submit-message', state)).toEqual({
      allowed: false,
      reason: 'awaiting-pause-decision',
    })
  })

  it('ignores a paused tool call this build offers no action for', () => {
    const session: Session = {
      id: 'session-unknown-pause',
      name: 'Session',
      messages: [
        message({
          id: 'paused',
          contentParts: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'future_tool',
              state: 'paused',
              pauseReason: undefined,
            },
          ],
        }),
      ],
    }

    expect(deriveSessionLockState(session).awaitingPauseDecision).toBe(false)
  })

  it('reports an idle session as fully unlocked', () => {
    const session: Session = {
      id: 'session-2',
      name: 'Session',
      messages: [message({ id: 'done', generating: false })],
    }

    expect(deriveSessionLockState(session)).toEqual(IDLE_SESSION_LOCK_STATE)
  })
})

describe('getSessionActionGate', () => {
  it('locks regenerate-class actions and summary deletion while replies stream', () => {
    const streaming = locks({ generatingReplyCount: 1, anyReplyGenerating: true })

    expect(getSessionActionGate('regenerate', streaming)).toEqual({ allowed: false, reason: 'generating' })
    expect(getSessionActionGate('save-and-resend', streaming)).toEqual({ allowed: false, reason: 'generating' })
    expect(getSessionActionGate('delete-summary', streaming)).toEqual({ allowed: false, reason: 'generating' })

    expect(getSessionActionGate('regenerate', IDLE_SESSION_LOCK_STATE)).toEqual({ allowed: true })
    expect(getSessionActionGate('delete-summary', IDLE_SESSION_LOCK_STATE)).toEqual({ allowed: true })
  })

  it('allows plain edits while other replies stream but never on a streaming target', () => {
    const streaming = locks({ generatingReplyCount: 1, anyReplyGenerating: true })

    expect(getSessionActionGate('edit-message', streaming)).toEqual({ allowed: true })
    expect(getSessionActionGate('edit-message', streaming, { messageGenerating: true })).toEqual({
      allowed: false,
      reason: 'message-streaming',
    })
    expect(getSessionActionGate('save-and-resend', IDLE_SESSION_LOCK_STATE, { messageGenerating: true })).toEqual({
      allowed: false,
      reason: 'message-streaming',
    })
  })

  it('locks fork controls during generation and compaction, generation reason first', () => {
    expect(
      getSessionActionGate(
        'switch-fork',
        locks({ generatingReplyCount: 1, anyReplyGenerating: true, compactionRunning: true })
      )
    ).toEqual({ allowed: false, reason: 'generating' })
    expect(getSessionActionGate('switch-fork', locks({ compactionRunning: true }))).toEqual({
      allowed: false,
      reason: 'compaction',
    })
    expect(getSessionActionGate('delete-fork', locks({ compactionRunning: true }))).toEqual({
      allowed: false,
      reason: 'compaction',
    })
    expect(getSessionActionGate('switch-fork', IDLE_SESSION_LOCK_STATE)).toEqual({ allowed: true })
  })

  it('lets chat mode switch forks while replies stream; deleting and other modes stay locked', () => {
    const streaming = locks({ generatingReplyCount: 1, anyReplyGenerating: true })

    expect(getSessionActionGate('switch-fork', streaming, { sessionMode: 'chat' })).toEqual({ allowed: true })
    // Work mode and hosts that do not pass sessionMode keep the conservative lock.
    expect(getSessionActionGate('switch-fork', streaming, { sessionMode: 'work' })).toEqual({
      allowed: false,
      reason: 'generating',
    })
    expect(getSessionActionGate('switch-fork', streaming)).toEqual({ allowed: false, reason: 'generating' })
    // Deleting a branch may kill a live stream — locked in every mode.
    expect(getSessionActionGate('delete-fork', streaming, { sessionMode: 'chat' })).toEqual({
      allowed: false,
      reason: 'generating',
    })
    // The compaction boundary lock is mode-independent.
    expect(getSessionActionGate('switch-fork', locks({ compactionRunning: true }), { sessionMode: 'chat' })).toEqual({
      allowed: false,
      reason: 'compaction',
    })
  })

  it('blocks submission during the placeholder window, compaction, and a pending pause decision', () => {
    expect(getSessionActionGate('submit-message', locks({ anyReplyGenerating: true }))).toEqual({
      allowed: false,
      reason: 'generating',
    })
    expect(getSessionActionGate('submit-message', locks({ compactionRunning: true }))).toEqual({
      allowed: false,
      reason: 'compaction',
    })
    expect(getSessionActionGate('submit-message', locks({ awaitingPauseDecision: true }))).toEqual({
      allowed: false,
      reason: 'awaiting-pause-decision',
    })
    expect(getSessionActionGate('submit-message', IDLE_SESSION_LOCK_STATE)).toEqual({ allowed: true })
  })
})

describe('assertSessionActionAllowed', () => {
  it('throws a typed error carrying the action and reason when blocked', () => {
    const streaming = locks({ generatingReplyCount: 1, anyReplyGenerating: true })

    expect(() => assertSessionActionAllowed('regenerate', streaming)).toThrowError(SessionActionBlockedError)
    try {
      assertSessionActionAllowed('switch-fork', locks({ compactionRunning: true }))
      expect.unreachable('should have thrown')
    } catch (error) {
      const blockedError = error as SessionActionBlockedError
      expect(blockedError.action).toBe('switch-fork')
      expect(blockedError.reason).toBe('compaction')
    }

    expect(() => assertSessionActionAllowed('regenerate', IDLE_SESSION_LOCK_STATE)).not.toThrow()
  })
})

describe('getSubmitAvailability', () => {
  it('keeps the control axis and the hard-block axis independent', () => {
    expect(getSubmitAvailability(IDLE_SESSION_LOCK_STATE)).toEqual({ control: 'send', blockReason: undefined })
    expect(getSubmitAvailability(locks({ anyReplyGenerating: true }))).toEqual({
      control: 'stop',
      blockReason: undefined,
    })
    expect(getSubmitAvailability(locks({ compactionRunning: true }))).toEqual({
      control: 'send',
      blockReason: 'compaction',
    })
    expect(getSubmitAvailability(locks({ awaitingPauseDecision: true }))).toEqual({
      control: 'send',
      blockReason: 'awaiting-pause-decision',
    })
    // A pending pause decision must keep its cue even while a reply streams.
    expect(getSubmitAvailability(locks({ anyReplyGenerating: true, awaitingPauseDecision: true }))).toEqual({
      control: 'stop',
      blockReason: 'awaiting-pause-decision',
    })
    // Compaction outranks the pause decision on the block axis, matching the gate order.
    expect(getSubmitAvailability(locks({ compactionRunning: true, awaitingPauseDecision: true }))).toEqual({
      control: 'send',
      blockReason: 'compaction',
    })
  })

  it('agrees with the submit-message gate on every lock combination', () => {
    for (const anyReplyGenerating of [false, true]) {
      for (const compactionRunning of [false, true]) {
        for (const awaitingPauseDecision of [false, true]) {
          const state = locks({
            anyReplyGenerating,
            generatingReplyCount: anyReplyGenerating ? 1 : 0,
            compactionRunning,
            awaitingPauseDecision,
          })
          const availability = getSubmitAvailability(state)
          const gate = getSessionActionGate('submit-message', state)
          expect(gate.allowed).toBe(availability.control === 'send' && availability.blockReason === undefined)
        }
      }
    }
  })
})

describe('shouldShowConcurrentReplyStop', () => {
  it('shows per-message stop only for opted-in alternative replies during concurrency', () => {
    const baseOptions = {
      allowStop: true,
      cancellable: true,
      sessionType: 'chat' as const,
    }

    expect(shouldShowConcurrentReplyStop({ ...baseOptions, generatingReplyCount: 1 })).toBe(false)
    expect(shouldShowConcurrentReplyStop({ ...baseOptions, generatingReplyCount: 2 })).toBe(true)
    expect(shouldShowConcurrentReplyStop({ ...baseOptions, cancellable: false, generatingReplyCount: 2 })).toBe(false)
    expect(shouldShowConcurrentReplyStop({ ...baseOptions, generatingReplyCount: 2, sessionType: 'picture' })).toBe(
      false
    )
    expect(
      shouldShowConcurrentReplyStop({
        allowStop: false,
        cancellable: true,
        generatingReplyCount: 2,
        sessionType: 'chat',
      })
    ).toBe(false)
  })
})
