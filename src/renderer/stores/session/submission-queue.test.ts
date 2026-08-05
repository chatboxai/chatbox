import type { Message } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSubmissionQueueState, resetSubmissionQueueStateForTests } from '../atoms/submissionQueueAtoms'

const { deleteAttachmentMock, submitUnlockedMock, withSessionGenerationLockMock } = vi.hoisted(() => ({
  deleteAttachmentMock: vi.fn(),
  submitUnlockedMock: vi.fn(),
  withSessionGenerationLockMock: vi.fn(),
}))

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    getSessionAttachmentRagController: () => ({ deleteAttachment: deleteAttachmentMock }),
  },
}))
vi.mock('./generation-lock', () => ({ withSessionGenerationLock: withSessionGenerationLockMock }))
vi.mock('./messages', () => ({ _submitNewUserMessageWithoutSessionLock: submitUnlockedMock }))

import {
  acceptSubmission,
  clearSessionSubmissionQueue,
  drainSubmissionQueue,
  pauseSubmissionQueue,
  removeQueuedSubmission,
  resetSubmissionQueueDispatcherForTests,
  resumeSubmissionQueue,
  updateQueuedSubmission,
  wakeSubmissionQueueAfterToolResolution,
} from './submission-queue'

function userMessage(id: string, text: string): Message {
  return { id, role: 'user', contentParts: [{ type: 'text', text }] }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('submission queue dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSubmissionQueueStateForTests()
    resetSubmissionQueueDispatcherForTests()
    withSessionGenerationLockMock.mockImplementation(async (_sessionId, task) => task())
    submitUnlockedMock.mockImplementation((_sessionId, params) => {
      params.onUserMessageCommitted?.()
      return { committed: true, generation: { status: 'completed' } }
    })
    deleteAttachmentMock.mockResolvedValue(undefined)
  })

  it('accepts a submission immediately and invokes the acceptance callback before dispatch', () => {
    // Catches accepting a submission only after the lock becomes available.
    withSessionGenerationLockMock.mockImplementationOnce(() => new Promise(() => {}))
    const onAccepted = vi.fn()

    const accepted = acceptSubmission(
      'session-1',
      { message: userMessage('message-1', 'first'), needGenerating: true },
      onAccepted
    )

    expect(accepted.state).toBe('pending')
    expect(onAccepted).toHaveBeenCalledOnce()
    expect(getSubmissionQueueState('session-1').items).toHaveLength(1)
  })

  it('uses an edited pending head after waiting for the session lock', async () => {
    // Catches snapshotting the head before the lock is acquired.
    let releaseLock = () => {}
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    withSessionGenerationLockMock.mockImplementationOnce(async (_sessionId, task) => {
      await lockGate
      return task()
    })
    const accepted = acceptSubmission('session-1', { message: userMessage('message-1', 'first'), needGenerating: true })
    const editedMessage = userMessage('message-1', 'edited')

    expect(updateQueuedSubmission('session-1', accepted.id, editedMessage)).toBe(true)
    releaseLock()
    await flushPromises()

    expect(submitUnlockedMock).toHaveBeenCalledWith('session-1', expect.objectContaining({ newUserMsg: editedMessage }))
  })

  it.each(['completed', 'stopped'] as const)('dispatches the next FIFO item after %s', async (status) => {
    // Catches stopping the drain loop after a non-error terminal outcome.
    submitUnlockedMock
      .mockImplementationOnce((_sessionId, params) => {
        params.onUserMessageCommitted?.()
        return { committed: true, generation: { status } }
      })
      .mockImplementationOnce((_sessionId, params) => {
        params.onUserMessageCommitted?.()
        return { committed: true, generation: { status: 'completed' } }
      })

    acceptSubmission('session-1', { message: userMessage('message-1', 'first'), needGenerating: true })
    acceptSubmission('session-1', { message: userMessage('message-2', 'second'), needGenerating: true })
    await flushPromises()

    expect(submitUnlockedMock.mock.calls.map(([, params]) => params.newUserMsg.id)).toEqual(['message-1', 'message-2'])
    expect(getSubmissionQueueState('session-1').items).toEqual([])
  })

  it('removes a committed failed item and pauses the remaining queue', async () => {
    // Catches retrying or retaining an item that already entered message history.
    submitUnlockedMock.mockImplementationOnce((_sessionId, params) => {
      params.onUserMessageCommitted?.()
      return { committed: true, generation: { status: 'failed', error: 'provider failed' } }
    })

    acceptSubmission('session-1', { message: userMessage('message-1', 'first'), needGenerating: true })
    acceptSubmission('session-1', { message: userMessage('message-2', 'second'), needGenerating: true })
    await flushPromises()

    expect(getSubmissionQueueState('session-1')).toMatchObject({
      status: 'paused',
      pauseReason: 'generation-error',
      error: 'provider failed',
      items: [
        expect.objectContaining({
          id: expect.any(String),
          message: expect.objectContaining({ id: 'message-2' }),
          state: 'pending',
        }),
      ],
    })
  })

  it('returns to idle when a failed generation leaves no queued messages', async () => {
    // Catches showing a resumable queue after its only item has already entered message history.
    submitUnlockedMock.mockImplementationOnce((_sessionId, params) => {
      params.onUserMessageCommitted?.()
      return { committed: true, generation: { status: 'failed', error: 'provider failed' } }
    })

    acceptSubmission('session-1', { message: userMessage('message-1', 'first'), needGenerating: true })
    await flushPromises()

    expect(getSubmissionQueueState('session-1')).toEqual({ items: [], status: 'idle' })
  })

  it('restores an uncommitted item to pending and pauses when submission throws', async () => {
    // Catches losing an item when work fails before it reaches message history.
    submitUnlockedMock.mockRejectedValueOnce(new Error('compaction failed'))

    acceptSubmission('session-1', { message: userMessage('message-1', 'first'), needGenerating: true })
    await flushPromises()

    expect(getSubmissionQueueState('session-1')).toMatchObject({
      status: 'paused',
      pauseReason: 'generation-error',
      error: 'compaction failed',
      items: [expect.objectContaining({ message: expect.objectContaining({ id: 'message-1' }), state: 'pending' })],
    })
  })

  it('pauses after a tool approval without sending the next item', async () => {
    // Catches advancing the queue while a tool approval owns the conversation.
    submitUnlockedMock.mockImplementationOnce((_sessionId, params) => {
      params.onUserMessageCommitted?.()
      return { committed: true, generation: { status: 'tool-paused' } }
    })

    acceptSubmission('session-1', { message: userMessage('message-1', 'first'), needGenerating: true })
    acceptSubmission('session-1', { message: userMessage('message-2', 'second'), needGenerating: true })
    await flushPromises()

    expect(getSubmissionQueueState('session-1')).toMatchObject({
      status: 'paused',
      pauseReason: 'tool-pause',
      items: [expect.objectContaining({ message: expect.objectContaining({ id: 'message-2' }) })],
    })
    expect(submitUnlockedMock).toHaveBeenCalledTimes(1)
  })

  it('schedules only one drain while a lock request is already waiting', () => {
    // Catches duplicate lock tasks that could dispatch the same queue head twice.
    withSessionGenerationLockMock.mockImplementation(() => new Promise(() => {}))

    acceptSubmission('session-1', { message: userMessage('message-1', 'first'), needGenerating: true })
    drainSubmissionQueue('session-1')
    drainSubmissionQueue('session-1')

    expect(withSessionGenerationLockMock).toHaveBeenCalledTimes(1)
  })

  it('dispatches the new head when the previous pending head is deleted while waiting', async () => {
    // Catches retaining a stale head captured before the lock opens.
    let releaseLock = () => {}
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    withSessionGenerationLockMock.mockImplementationOnce(async (_sessionId, task) => {
      await lockGate
      return task()
    })
    const first = acceptSubmission('session-1', { message: userMessage('message-1', 'first'), needGenerating: true })
    acceptSubmission('session-1', { message: userMessage('message-2', 'second'), needGenerating: true })

    await expect(removeQueuedSubmission('session-1', first.id)).resolves.toBe(true)
    releaseLock()
    await flushPromises()

    expect(submitUnlockedMock).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ newUserMsg: expect.objectContaining({ id: 'message-2' }) })
    )
  })

  it('schedules separate lock tasks for different sessions', () => {
    // Catches globally serializing independent sessions.
    withSessionGenerationLockMock.mockImplementation(() => new Promise(() => {}))

    acceptSubmission('session-1', { message: userMessage('message-1', 'first'), needGenerating: true })
    acceptSubmission('session-2', { message: userMessage('message-2', 'second'), needGenerating: true })

    expect(withSessionGenerationLockMock).toHaveBeenCalledTimes(2)
    expect(withSessionGenerationLockMock.mock.calls.map(([sessionId]) => sessionId)).toEqual(['session-1', 'session-2'])
  })

  it('resumes only a queue paused for tool approval after that tool resolves', () => {
    // Catches a stale tool pause permanently blocking queued messages.
    withSessionGenerationLockMock.mockImplementation(() => new Promise(() => {}))
    acceptSubmission('session-1', { message: userMessage('message-1', 'first'), needGenerating: true })
    pauseSubmissionQueue('session-1', 'tool-pause')

    wakeSubmissionQueueAfterToolResolution('session-1')

    expect(getSubmissionQueueState('session-1').status).toBe('idle')
  })

  it('clears queue state before best-effort attachment cleanup', async () => {
    // Catches restoring discarded messages when cleanup fails.
    withSessionGenerationLockMock.mockImplementation(() => new Promise(() => {}))
    deleteAttachmentMock.mockRejectedValueOnce(new Error('cleanup failed'))
    acceptSubmission('session-1', {
      message: { ...userMessage('message-1', 'first'), files: [{ sessionAttachmentId: 42 }] } as Message,
      needGenerating: true,
    })

    await clearSessionSubmissionQueue('session-1')

    expect(getSubmissionQueueState('session-1').items).toEqual([])
    expect(deleteAttachmentMock).toHaveBeenCalledWith(42)
  })

  it('releases session-RAG attachments from an uncommitted dispatching item when clearing the queue', async () => {
    // Catches leaking RAG entries when clear races with the user-message storage commit.
    let releaseSubmission = () => {}
    const submissionGate = new Promise<void>((resolve) => {
      releaseSubmission = resolve
    })
    submitUnlockedMock.mockImplementationOnce(async () => {
      await submissionGate
      return {
        committed: false,
        generation: { status: 'failed', error: 'Queued submission was discarded before commit' },
      }
    })

    acceptSubmission('session-1', {
      message: { ...userMessage('message-1', 'first'), files: [{ sessionAttachmentId: 42 }] } as Message,
      needGenerating: true,
    })
    await flushPromises()

    expect(getSubmissionQueueState('session-1').items[0]?.state).toBe('dispatching')
    await clearSessionSubmissionQueue('session-1')

    expect(deleteAttachmentMock).toHaveBeenCalledWith(42)
    releaseSubmission()
  })

  it('invalidates an in-flight dispatch when its queue is discarded before commit', async () => {
    // Catches a stale lock task committing a message after clearSessionSubmissionQueue has discarded it.
    let allowCommit = () => {}
    const beforeCommit = new Promise<void>((resolve) => {
      allowCommit = resolve
    })
    const committed = vi.fn()
    submitUnlockedMock.mockImplementationOnce(async (_sessionId, params) => {
      await beforeCommit
      if ((params.shouldCommit ?? (() => true))()) {
        committed()
        params.onUserMessageCommitted?.()
        return { committed: true, generation: { status: 'completed' } }
      }
      return {
        committed: false,
        generation: { status: 'failed', error: 'Queued submission was discarded before commit' },
      }
    })

    acceptSubmission('session-1', { message: userMessage('message-1', 'first'), needGenerating: true })
    await flushPromises()
    await clearSessionSubmissionQueue('session-1')
    allowCommit()
    await flushPromises()

    expect(committed).not.toHaveBeenCalled()
    expect(getSubmissionQueueState('session-1').items).toEqual([])
  })

  it('releases removed session-RAG attachments when a pending message is edited', async () => {
    // Catches orphaned session-RAG records after replacing a queued message's files.
    withSessionGenerationLockMock.mockImplementation(() => new Promise(() => {}))
    const accepted = acceptSubmission('session-1', {
      message: {
        ...userMessage('message-1', 'first'),
        files: [{ id: 'file-1', name: 'old.pdf', fileType: 'application/pdf', sessionAttachmentId: 42 }],
      } as Message,
      needGenerating: true,
    })

    const updated = {
      ...userMessage('message-1', 'edited'),
      files: [{ id: 'file-2', name: 'new.pdf', fileType: 'application/pdf', sessionAttachmentId: 43 }],
      links: [{ id: 'link-1', url: 'https://example.com' }],
      contentParts: [{ type: 'image', storageKey: 'image-1' }],
    } as Message

    expect(updateQueuedSubmission('session-1', accepted.id, updated)).toBe(true)
    await flushPromises()

    expect(deleteAttachmentMock).toHaveBeenCalledTimes(1)
    expect(deleteAttachmentMock).toHaveBeenCalledWith(42)
    expect(getSubmissionQueueState('session-1').items[0]?.message).toMatchObject({
      files: [expect.objectContaining({ sessionAttachmentId: 43 })],
      links: [expect.objectContaining({ id: 'link-1' })],
    })
  })

  it('does not resume a generation-error queue until explicitly resumed', () => {
    // Catches tool resolution incorrectly bypassing an error pause.
    withSessionGenerationLockMock.mockImplementation(() => new Promise(() => {}))
    acceptSubmission('session-1', { message: userMessage('message-1', 'first'), needGenerating: true })
    pauseSubmissionQueue('session-1', 'generation-error', 'provider failed')

    wakeSubmissionQueueAfterToolResolution('session-1')

    expect(getSubmissionQueueState('session-1').status).toBe('paused')
    resumeSubmissionQueue('session-1')
    expect(getSubmissionQueueState('session-1').status).toBe('idle')
  })
})
