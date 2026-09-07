// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approvalAttentionStore,
  flashApprovalCardHighlight,
  pulsePendingActionBar,
  registerPausedStepElement,
  revealPausedStep,
  unregisterPausedStepElement,
} from './approvalAttentionStore'

beforeEach(() => {
  approvalAttentionStore.setState({ highlightedPausedStep: null, barPulseToken: 0 })
})

describe('highlight flash', () => {
  it('flashes the highlight and clears it after the timeout', () => {
    vi.useFakeTimers()
    try {
      flashApprovalCardHighlight('session-1', 'message-1', 'tc-1')
      expect(approvalAttentionStore.getState().highlightedPausedStep).toEqual({
        sessionId: 'session-1',
        messageId: 'message-1',
        toolCallId: 'tc-1',
      })
      vi.advanceTimersByTime(5100)
      expect(approvalAttentionStore.getState().highlightedPausedStep).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the latest highlight when re-flashed before the timeout', () => {
    vi.useFakeTimers()
    try {
      flashApprovalCardHighlight('session-1', 'message-1', 'tc-1')
      vi.advanceTimersByTime(4000)
      flashApprovalCardHighlight('session-1', 'message-2', 'tc-2')
      vi.advanceTimersByTime(4500)
      expect(approvalAttentionStore.getState().highlightedPausedStep).toEqual({
        sessionId: 'session-1',
        messageId: 'message-2',
        toolCallId: 'tc-2',
      })
      vi.advanceTimersByTime(700)
      expect(approvalAttentionStore.getState().highlightedPausedStep).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('paused-step reveal', () => {
  it('targets the current message when another message reuses the same tool call id', async () => {
    vi.useFakeTimers()
    const historical = document.createElement('div')
    const current = document.createElement('div')
    historical.scrollIntoView = vi.fn()
    current.scrollIntoView = vi.fn()
    registerPausedStepElement('session-1', 'message-old', 'tc-reused', 'old', historical)
    registerPausedStepElement('session-1', 'message-current', 'tc-reused', 'current', current)

    try {
      const reveal = revealPausedStep('session-1', 'message-current', 'tc-reused')
      await vi.advanceTimersByTimeAsync(300)
      await reveal

      expect(current.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
      expect(historical.scrollIntoView).not.toHaveBeenCalled()
    } finally {
      unregisterPausedStepElement('session-1', 'message-old', 'tc-reused', 'old')
      unregisterPausedStepElement('session-1', 'message-current', 'tc-reused', 'current')
      await vi.runAllTimersAsync()
      vi.useRealTimers()
    }
  })
})

describe('pending-action bar pulse', () => {
  it('increments the token on every pulse so the animation can restart', () => {
    pulsePendingActionBar()
    expect(approvalAttentionStore.getState().barPulseToken).toBe(1)
    pulsePendingActionBar()
    expect(approvalAttentionStore.getState().barPulseToken).toBe(2)
  })
})
