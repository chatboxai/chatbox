import type { Message } from '@shared/types'
import { atom, getDefaultStore } from 'jotai'

export type QueuedSubmissionState = 'pending' | 'dispatching'
export type SubmissionQueuePauseReason = 'generation-error' | 'tool-pause'

export interface QueuedSubmission {
  id: string
  sessionId: string
  message: Message
  needGenerating: boolean
  createdAt: number
  state: QueuedSubmissionState
}

export interface SessionSubmissionQueue {
  items: QueuedSubmission[]
  status: 'idle' | 'draining' | 'paused'
  pauseReason?: SubmissionQueuePauseReason
  error?: string
}

const defaultSubmissionQueueState: SessionSubmissionQueue = Object.freeze({
  items: Object.freeze([]) as unknown as QueuedSubmission[],
  status: 'idle' as const,
})

export const submissionQueueStateMapAtom = atom<Record<string, SessionSubmissionQueue>>({})

function getQueueStateMap(): Record<string, SessionSubmissionQueue> {
  return getDefaultStore().get(submissionQueueStateMapAtom)
}

function setQueueState(sessionId: string, queue: SessionSubmissionQueue): void {
  const store = getDefaultStore()
  const currentMap = store.get(submissionQueueStateMapAtom)
  store.set(submissionQueueStateMapAtom, { ...currentMap, [sessionId]: queue })
}

export function getSubmissionQueueState(sessionId: string): SessionSubmissionQueue {
  return getQueueStateMap()[sessionId] ?? defaultSubmissionQueueState
}

export function appendQueuedSubmission(item: QueuedSubmission): void {
  const queue = getSubmissionQueueState(item.sessionId)
  setQueueState(item.sessionId, { ...queue, items: [...queue.items, item] })
}

export function updatePendingQueuedSubmission(sessionId: string, itemId: string, message: Message): boolean {
  const queue = getSubmissionQueueState(sessionId)
  const itemIndex = queue.items.findIndex((item) => item.id === itemId && item.state === 'pending')
  if (itemIndex === -1) return false

  const items = queue.items.map((item, index) => (index === itemIndex ? { ...item, message } : item))
  setQueueState(sessionId, { ...queue, items })
  return true
}

export function removePendingQueuedSubmission(sessionId: string, itemId: string): QueuedSubmission | undefined {
  const queue = getSubmissionQueueState(sessionId)
  const itemIndex = queue.items.findIndex((item) => item.id === itemId && item.state === 'pending')
  if (itemIndex === -1) return undefined

  const [removed] = queue.items.slice(itemIndex, itemIndex + 1)
  const items = queue.items.filter((_, index) => index !== itemIndex)
  setQueueState(sessionId, { ...queue, items })
  return removed
}

export function markQueuedSubmissionDispatching(sessionId: string, itemId: string): boolean {
  return updateQueuedSubmissionState(sessionId, itemId, 'pending', 'dispatching')
}

export function restoreQueuedSubmissionPending(sessionId: string, itemId: string): boolean {
  return updateQueuedSubmissionState(sessionId, itemId, 'dispatching', 'pending')
}

function updateQueuedSubmissionState(
  sessionId: string,
  itemId: string,
  from: QueuedSubmissionState,
  to: QueuedSubmissionState
): boolean {
  const queue = getSubmissionQueueState(sessionId)
  const itemIndex = queue.items.findIndex((item) => item.id === itemId && item.state === from)
  if (itemIndex === -1) return false

  const items = queue.items.map((item, index) => (index === itemIndex ? { ...item, state: to } : item))
  setQueueState(sessionId, { ...queue, items })
  return true
}

export function removeCommittedQueuedSubmission(sessionId: string, itemId: string): QueuedSubmission | undefined {
  const queue = getSubmissionQueueState(sessionId)
  const itemIndex = queue.items.findIndex((item) => item.id === itemId)
  if (itemIndex === -1) return undefined

  const [removed] = queue.items.slice(itemIndex, itemIndex + 1)
  const items = queue.items.filter((_, index) => index !== itemIndex)
  setQueueState(sessionId, { ...queue, items })
  return removed
}

export function setSubmissionQueueStatus(
  sessionId: string,
  status: SessionSubmissionQueue['status'],
  details?: { pauseReason?: SubmissionQueuePauseReason; error?: string }
): void {
  const queue = getSubmissionQueueState(sessionId)
  setQueueState(sessionId, {
    items: [...queue.items],
    status,
    ...(details?.pauseReason ? { pauseReason: details.pauseReason } : {}),
    ...(details?.error ? { error: details.error } : {}),
  })
}

export function clearSubmissionQueueState(sessionId: string): QueuedSubmission[] {
  const store = getDefaultStore()
  const stateMap = store.get(submissionQueueStateMapAtom)
  const queue = stateMap[sessionId]
  if (!queue) return []

  const { [sessionId]: _, ...remainingStateMap } = stateMap
  store.set(submissionQueueStateMapAtom, remainingStateMap)
  return [...queue.items]
}

export function resetSubmissionQueueStateForTests(): void {
  getDefaultStore().set(submissionQueueStateMapAtom, {})
}
