import type { Message } from '@shared/types'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendQueuedSubmission,
  clearSubmissionQueueState,
  getSubmissionQueueState,
  markQueuedSubmissionDispatching,
  type QueuedSubmission,
  removeCommittedQueuedSubmission,
  removePendingQueuedSubmission,
  resetSubmissionQueueStateForTests,
  restoreQueuedSubmissionPending,
  setSubmissionQueueStatus,
  updatePendingQueuedSubmission,
} from './submissionQueueAtoms'

function makeMessage(id: string, text: string): Message {
  return {
    id,
    role: 'user',
    contentParts: [{ type: 'text', text }],
  } as Message
}

function makeQueuedSubmission(id: string, sessionId: string, text: string): QueuedSubmission {
  return {
    id,
    sessionId,
    message: makeMessage(`message-${id}`, text),
    needGenerating: true,
    createdAt: 1,
    state: 'pending',
  }
}

describe('submission queue atoms', () => {
  afterEach(() => {
    resetSubmissionQueueStateForTests()
  })

  it('appends pending items in FIFO order', () => {
    const first = makeQueuedSubmission('queue-1', 'session-1', 'first')
    const second = makeQueuedSubmission('queue-2', 'session-1', 'second')

    appendQueuedSubmission(first)
    appendQueuedSubmission(second)

    expect(getSubmissionQueueState('session-1').items.map((item) => item.id)).toEqual(['queue-1', 'queue-2'])
  })

  it('edits only pending items without mutating the original item', () => {
    const first = makeQueuedSubmission('queue-1', 'session-1', 'first')
    const editedMessage = makeMessage('message-queue-1', 'edited')
    appendQueuedSubmission(first)

    expect(updatePendingQueuedSubmission('session-1', 'queue-1', editedMessage)).toBe(true)
    expect(getSubmissionQueueState('session-1').items[0].message).toEqual(editedMessage)
    expect(getSubmissionQueueState('session-1').items[0]).not.toBe(first)
    expect(first.message).not.toEqual(editedMessage)
  })

  it('removes only pending items and returns the removed item', () => {
    const first = makeQueuedSubmission('queue-1', 'session-1', 'first')
    appendQueuedSubmission(first)

    expect(removePendingQueuedSubmission('session-1', 'queue-1')).toEqual(first)
    expect(getSubmissionQueueState('session-1').items).toEqual([])
  })

  it('prevents pending edits and removal after an item begins dispatching', () => {
    const first = makeQueuedSubmission('queue-1', 'session-1', 'first')
    const editedMessage = makeMessage('message-queue-1', 'edited')
    appendQueuedSubmission(first)

    expect(markQueuedSubmissionDispatching('session-1', 'queue-1')).toBe(true)
    expect(updatePendingQueuedSubmission('session-1', 'queue-1', editedMessage)).toBe(false)
    expect(removePendingQueuedSubmission('session-1', 'queue-1')).toBeUndefined()
    expect(getSubmissionQueueState('session-1').items[0].state).toBe('dispatching')
  })

  it('restores dispatching items and removes committed dispatching items', () => {
    const first = makeQueuedSubmission('queue-1', 'session-1', 'first')
    appendQueuedSubmission(first)
    markQueuedSubmissionDispatching('session-1', 'queue-1')

    expect(restoreQueuedSubmissionPending('session-1', 'queue-1')).toBe(true)
    expect(getSubmissionQueueState('session-1').items[0].state).toBe('pending')
    expect(removeCommittedQueuedSubmission('session-1', 'queue-1')).toEqual({ ...first, state: 'pending' })
  })

  it('pauses and resumes a session queue with its pause details', () => {
    setSubmissionQueueStatus('session-1', 'paused', {
      pauseReason: 'generation-error',
      error: 'Generation failed',
    })

    expect(getSubmissionQueueState('session-1')).toMatchObject({
      status: 'paused',
      pauseReason: 'generation-error',
      error: 'Generation failed',
    })

    setSubmissionQueueStatus('session-1', 'draining')

    expect(getSubmissionQueueState('session-1')).toEqual({ items: [], status: 'draining' })
  })

  it('keeps queues isolated by session', () => {
    appendQueuedSubmission(makeQueuedSubmission('queue-1', 'session-1', 'first'))
    appendQueuedSubmission(makeQueuedSubmission('queue-2', 'session-2', 'second'))

    expect(getSubmissionQueueState('session-1').items.map((item) => item.id)).toEqual(['queue-1'])
    expect(getSubmissionQueueState('session-2').items.map((item) => item.id)).toEqual(['queue-2'])
  })

  it('clears one session and resets all queue state for tests', () => {
    const first = makeQueuedSubmission('queue-1', 'session-1', 'first')
    const second = makeQueuedSubmission('queue-2', 'session-2', 'second')
    appendQueuedSubmission(first)
    appendQueuedSubmission(second)

    expect(clearSubmissionQueueState('session-1')).toEqual([first])
    expect(getSubmissionQueueState('session-1')).toEqual({ items: [], status: 'idle' })
    expect(getSubmissionQueueState('session-2').items).toEqual([second])

    resetSubmissionQueueStateForTests()

    expect(getSubmissionQueueState('session-2')).toEqual({ items: [], status: 'idle' })
  })
})
