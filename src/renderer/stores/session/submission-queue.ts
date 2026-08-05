import type { Message } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import platform from '@/platform'
import {
  appendQueuedSubmission,
  clearSubmissionQueueState,
  getSubmissionQueueState,
  markQueuedSubmissionDispatching,
  type QueuedSubmission,
  removeCommittedQueuedSubmission,
  removePendingQueuedSubmission,
  restoreQueuedSubmissionPending,
  type SubmissionQueuePauseReason,
  setSubmissionQueueStatus,
  updatePendingQueuedSubmission,
} from '../atoms/submissionQueueAtoms'
import { withSessionGenerationLock } from './generation-lock'
import type { SubmissionOutcome } from './generation-outcome'
import { _submitNewUserMessageWithoutSessionLock } from './messages'

export type { GenerationOutcome, SubmissionOutcome } from './generation-outcome'

export interface NewQueuedSubmission {
  message: Message
  needGenerating: boolean
}

const scheduledSessionDrains = new Set<string>()
const submissionQueueEpochs = new Map<string, number>()

/** Test-only reset matching the generation-lock test isolation helper. */
export function resetSubmissionQueueDispatcherForTests(): void {
  scheduledSessionDrains.clear()
  submissionQueueEpochs.clear()
}

function getSubmissionQueueEpoch(sessionId: string): number {
  return submissionQueueEpochs.get(sessionId) ?? 0
}

function invalidateSubmissionQueueDispatches(sessionId: string): void {
  submissionQueueEpochs.set(sessionId, getSubmissionQueueEpoch(sessionId) + 1)
}

function cloneMessageForQueue(message: Message): Message {
  return {
    ...message,
    cancel: undefined,
    contentParts: message.contentParts.map((part) => ({ ...part })),
    files: message.files?.map((file) => ({ ...file })),
    links: message.links?.map((link) => ({ ...link })),
    status: message.status?.map((status) => ({ ...status })),
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function cleanupSessionAttachments(message: Message): Promise<void> {
  if (platform.type !== 'desktop') return

  await cleanupSessionAttachmentIds(
    message.files
      ?.map((file) => file.sessionAttachmentId)
      .filter((attachmentId): attachmentId is number => typeof attachmentId === 'number') ?? []
  )
}

async function cleanupSessionAttachmentIds(attachmentIds: number[]): Promise<void> {
  if (platform.type !== 'desktop') return

  for (const attachmentId of new Set(attachmentIds)) {
    try {
      await platform.getSessionAttachmentRagController().deleteAttachment(attachmentId)
    } catch (error) {
      console.warn('Failed to cleanup queued session attachment RAG entry:', error)
    }
  }
}

export function acceptSubmission(
  sessionId: string,
  input: NewQueuedSubmission,
  onAccepted?: () => void
): QueuedSubmission {
  const item: QueuedSubmission = {
    id: uuidv4(),
    sessionId,
    message: cloneMessageForQueue(input.message),
    needGenerating: input.needGenerating,
    createdAt: Date.now(),
    state: 'pending',
  }
  appendQueuedSubmission(item)
  onAccepted?.()
  drainSubmissionQueue(sessionId)
  return item
}

export function updateQueuedSubmission(sessionId: string, itemId: string, message: Message): boolean {
  const previous = getSubmissionQueueState(sessionId).items.find(
    (item) => item.id === itemId && item.state === 'pending'
  )
  const nextMessage = cloneMessageForQueue(message)
  const updated = updatePendingQueuedSubmission(sessionId, itemId, nextMessage)
  if (!updated || !previous) return false

  const retainedAttachmentIds = new Set(
    nextMessage.files
      ?.map((file) => file.sessionAttachmentId)
      .filter((attachmentId): attachmentId is number => typeof attachmentId === 'number') ?? []
  )
  const removedAttachmentIds =
    previous.message.files
      ?.map((file) => file.sessionAttachmentId)
      .filter(
        (attachmentId): attachmentId is number =>
          typeof attachmentId === 'number' && !retainedAttachmentIds.has(attachmentId)
      ) ?? []
  void cleanupSessionAttachmentIds(removedAttachmentIds)
  return true
}

export async function removeQueuedSubmission(sessionId: string, itemId: string): Promise<boolean> {
  const removed = removePendingQueuedSubmission(sessionId, itemId)
  if (!removed) return false

  await cleanupSessionAttachments(removed.message)
  return true
}

export function pauseSubmissionQueue(sessionId: string, reason: SubmissionQueuePauseReason, error?: string): void {
  setSubmissionQueueStatus(sessionId, 'paused', { pauseReason: reason, error })
}

function pauseSubmissionQueueIfItemsRemain(
  sessionId: string,
  reason: SubmissionQueuePauseReason,
  error?: string
): void {
  if (getSubmissionQueueState(sessionId).items.length > 0) {
    pauseSubmissionQueue(sessionId, reason, error)
  } else {
    setSubmissionQueueStatus(sessionId, 'idle')
  }
}

export function resumeSubmissionQueue(sessionId: string): void {
  setSubmissionQueueStatus(sessionId, 'idle')
  drainSubmissionQueue(sessionId)
}

export async function clearSessionSubmissionQueue(sessionId: string): Promise<void> {
  invalidateSubmissionQueueDispatches(sessionId)
  const removed = clearSubmissionQueueState(sessionId)
  // A dispatching item remains in the queue only until its user message commits.
  // Once invalidated, both it and pending items are safe to release.
  await Promise.all(removed.map((item) => cleanupSessionAttachments(item.message)))
}

export function wakeSubmissionQueueAfterToolResolution(sessionId: string): void {
  const state = getSubmissionQueueState(sessionId)
  if (state.status === 'paused' && state.pauseReason === 'tool-pause') {
    resumeSubmissionQueue(sessionId)
  }
}

export function drainSubmissionQueue(sessionId: string): void {
  const queue = getSubmissionQueueState(sessionId)
  if (scheduledSessionDrains.has(sessionId) || queue.status === 'paused' || queue.items.length === 0) return

  scheduledSessionDrains.add(sessionId)
  void withSessionGenerationLock(sessionId, () => drainSubmissionQueueWithoutLock(sessionId))
    .catch((error) => {
      pauseSubmissionQueue(sessionId, 'generation-error', toErrorMessage(error))
    })
    .finally(() => {
      scheduledSessionDrains.delete(sessionId)
      const latest = getSubmissionQueueState(sessionId)
      if (latest.status !== 'paused' && latest.items.length > 0) {
        drainSubmissionQueue(sessionId)
      }
    })
}

async function drainSubmissionQueueWithoutLock(sessionId: string): Promise<void> {
  while (true) {
    const queue = getSubmissionQueueState(sessionId)
    if (queue.status === 'paused') return

    const head = queue.items[0]
    if (!head) {
      setSubmissionQueueStatus(sessionId, 'idle')
      return
    }

    if (!markQueuedSubmissionDispatching(sessionId, head.id)) {
      continue
    }
    setSubmissionQueueStatus(sessionId, 'draining')
    const dispatchEpoch = getSubmissionQueueEpoch(sessionId)
    const isDispatchEpochCurrent = () => getSubmissionQueueEpoch(sessionId) === dispatchEpoch
    const canCommitDispatch = () =>
      isDispatchEpochCurrent() &&
      getSubmissionQueueState(sessionId).items.some((item) => item.id === head.id && item.state === 'dispatching')

    let committed = false
    let outcome: SubmissionOutcome
    try {
      outcome = await _submitNewUserMessageWithoutSessionLock(sessionId, {
        newUserMsg: head.message,
        needGenerating: head.needGenerating,
        shouldCommit: canCommitDispatch,
        onUserMessageCommitted: () => {
          if (!canCommitDispatch()) return
          committed = true
          removeCommittedQueuedSubmission(sessionId, head.id)
        },
      })
    } catch (error) {
      if (!isDispatchEpochCurrent()) return
      if (!committed) {
        restoreQueuedSubmissionPending(sessionId, head.id)
      }
      pauseSubmissionQueue(sessionId, 'generation-error', toErrorMessage(error))
      return
    }

    if (!isDispatchEpochCurrent()) return

    if (!committed) {
      restoreQueuedSubmissionPending(sessionId, head.id)
      pauseSubmissionQueue(
        sessionId,
        'generation-error',
        outcome.generation.status === 'failed' ? outcome.generation.error : undefined
      )
      return
    }

    if (outcome.generation.status === 'completed' || outcome.generation.status === 'stopped') {
      continue
    }
    if (outcome.generation.status === 'tool-paused') {
      pauseSubmissionQueueIfItemsRemain(sessionId, 'tool-pause')
      return
    }
    pauseSubmissionQueueIfItemsRemain(sessionId, 'generation-error', outcome.generation.error)
    return
  }
}
