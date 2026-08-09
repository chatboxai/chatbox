import { collectReachableMessages } from '@shared/session/message-forks'
import type { Message, Session } from '@shared/types'
import { createStore, useStore } from 'zustand'

type GenerationRuntimeState = {
  activeMessageIdsBySession: Record<string, string[]>
}

const initialState: GenerationRuntimeState = {
  activeMessageIdsBySession: {},
}

const cancelCallbacks = new Map<string, NonNullable<Message['cancel']>>()
const pendingCancellations = new Set<string>()
const blockedSessionIds = new Set<string>()
const generationSettlements = new Map<string, { sessionId: string; promise: Promise<void>; resolve: () => void }>()

export const generationRuntimeStore = createStore<GenerationRuntimeState>(() => initialState)

function generationKey(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`
}

function removeActiveMessage(sessionId: string, messageId: string): boolean {
  let removed = false
  generationRuntimeStore.setState((state) => {
    const currentIds = state.activeMessageIdsBySession[sessionId]
    if (!currentIds?.includes(messageId)) return state

    removed = true
    const remainingIds = currentIds.filter((id) => id !== messageId)
    const activeMessageIdsBySession = { ...state.activeMessageIdsBySession }
    if (remainingIds.length > 0) {
      activeMessageIdsBySession[sessionId] = remainingIds
    } else {
      delete activeMessageIdsBySession[sessionId]
    }
    return { activeMessageIdsBySession }
  })
  return removed
}

export function beginSessionGeneration(sessionId: string, messageId: string): boolean {
  if (blockedSessionIds.has(sessionId)) return false

  const key = generationKey(sessionId, messageId)
  if (!generationSettlements.has(key)) {
    let resolve!: () => void
    const promise = new Promise<void>((settle) => {
      resolve = settle
    })
    generationSettlements.set(key, { sessionId, promise, resolve })
  }
  generationRuntimeStore.setState((state) => {
    const currentIds = state.activeMessageIdsBySession[sessionId] ?? []
    if (currentIds.includes(messageId)) return state
    return {
      activeMessageIdsBySession: {
        ...state.activeMessageIdsBySession,
        [sessionId]: [...currentIds, messageId],
      },
    }
  })
  return true
}

export function registerSessionGenerationCancel(
  sessionId: string,
  messageId: string,
  cancel: NonNullable<Message['cancel']>
): void {
  const key = generationKey(sessionId, messageId)
  const active = generationRuntimeStore.getState().activeMessageIdsBySession[sessionId]?.includes(messageId) === true
  if (!active || pendingCancellations.delete(key)) {
    cancel()
    return
  }
  cancelCallbacks.set(key, cancel)
}

export function cancelSessionGeneration(sessionId: string, messageId: string, stoppedAt = Date.now()): boolean {
  if (!removeActiveMessage(sessionId, messageId)) return false

  const key = generationKey(sessionId, messageId)
  const cancel = cancelCallbacks.get(key)
  cancelCallbacks.delete(key)
  if (cancel) {
    cancel(stoppedAt)
  } else {
    pendingCancellations.add(key)
  }
  return true
}

export function cancelSessionGenerationMessages(sessionId: string, messages: readonly Message[]): void {
  const seen = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant' || message.generating !== true || seen.has(message.id)) continue
    seen.add(message.id)
    if (!cancelSessionGeneration(sessionId, message.id)) {
      message.cancel?.()
    }
  }
}

export function settleSessionGeneration(sessionId: string, messageId: string): boolean {
  const key = generationKey(sessionId, messageId)
  const wasActive = removeActiveMessage(sessionId, messageId)
  cancelCallbacks.delete(key)
  pendingCancellations.delete(key)
  const settlement = generationSettlements.get(key)
  generationSettlements.delete(key)
  settlement?.resolve()
  return wasActive
}

export function reconcileSessionGenerationRuntime(session: Session): void {
  const activeIds = generationRuntimeStore.getState().activeMessageIdsBySession[session.id] ?? []
  if (activeIds.length === 0) return

  const reachableIds = new Set(
    collectReachableMessages(session, [
      session.messages,
      ...(session.threads ?? []).map((thread) => thread.messages),
    ]).map((message) => message.id)
  )
  for (const messageId of activeIds) {
    if (!reachableIds.has(messageId)) {
      cancelSessionGeneration(session.id, messageId)
    }
  }
}

export function clearSessionGenerationRuntime(sessionId: string): void {
  const activeIds = [...(generationRuntimeStore.getState().activeMessageIdsBySession[sessionId] ?? [])]
  for (const messageId of activeIds) {
    cancelSessionGeneration(sessionId, messageId)
  }
}

export async function cancelAndWaitForSessionGenerations(sessionId: string): Promise<void> {
  blockedSessionIds.add(sessionId)
  clearSessionGenerationRuntime(sessionId)
  const pending = [...generationSettlements.values()]
    .filter((settlement) => settlement.sessionId === sessionId)
    .map((settlement) => settlement.promise)
  await Promise.all(pending)
}

export function releaseSessionGenerationBlock(sessionId: string): void {
  blockedSessionIds.delete(sessionId)
}

export function isSessionGenerating(state: GenerationRuntimeState, sessionId: string): boolean {
  return Boolean(state.activeMessageIdsBySession[sessionId]?.length)
}

export function useSessionGenerating(sessionId: string): boolean {
  return useStore(generationRuntimeStore, (state) => isSessionGenerating(state, sessionId))
}

export function resetSessionGenerationRuntime(): void {
  for (const settlement of generationSettlements.values()) {
    settlement.resolve()
  }
  cancelCallbacks.clear()
  pendingCancellations.clear()
  blockedSessionIds.clear()
  generationSettlements.clear()
  generationRuntimeStore.setState(initialState, true)
}
