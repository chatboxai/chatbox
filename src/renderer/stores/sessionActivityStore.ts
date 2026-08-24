import type { Message } from '@shared/types'
import { getDefaultStore } from 'jotai'
import { useSyncExternalStore } from 'react'
import { createStore, useStore } from 'zustand'
import { rendererApplication } from '@/app/renderer-application'
import { currentSessionIdAtom } from './atoms/sessionAtoms'
import { isSuccessfulAssistantReply } from './session/message-success'

const generationRuntimeStore = rendererApplication.generationRuntime

export type SessionActivity = 'idle' | 'generating' | 'waiting' | 'completed'

type SessionActivityState = {
  unreadCompletedSessionIds: Record<string, true>
}

const initialState: SessionActivityState = {
  unreadCompletedSessionIds: {},
}

export const sessionActivityStore = createStore<SessionActivityState>(() => initialState)

export function markSessionReplyCompleted(sessionId: string, message: Message): void {
  if (!isSuccessfulAssistantReply(message)) return
  if (getDefaultStore().get(currentSessionIdAtom) === sessionId) return
  sessionActivityStore.setState((state) => {
    if (state.unreadCompletedSessionIds[sessionId]) return state
    return {
      unreadCompletedSessionIds: {
        ...state.unreadCompletedSessionIds,
        [sessionId]: true,
      },
    }
  })
}

export function clearSessionActivity(sessionId: string): void {
  sessionActivityStore.setState((state) => {
    if (!state.unreadCompletedSessionIds[sessionId]) return state
    const unreadCompletedSessionIds = { ...state.unreadCompletedSessionIds }
    delete unreadCompletedSessionIds[sessionId]
    return { unreadCompletedSessionIds }
  })
}

export function getSessionActivity(
  state: SessionActivityState,
  sessionId: string,
  generating = false,
  waiting = false
): SessionActivity {
  if (generating) return 'generating'
  if (waiting) return 'waiting'
  if (state.unreadCompletedSessionIds[sessionId]) return 'completed'
  return 'idle'
}

export function isSessionGenerating(sessionId: string): boolean {
  return generationRuntimeStore.list(sessionId).some((runtime) => runtime.phase !== 'paused')
}

function useSessionGenerating(sessionId: string): boolean {
  return useSyncExternalStore(
    (listener) => generationRuntimeStore.subscribe(listener),
    () => isSessionGenerating(sessionId),
    () => false
  )
}

/**
 * "Waiting for you" comes from the persisted `hasPausedToolCall` projection,
 * never from paused generation runtimes: a paused runtime can belong to an
 * inactive fork branch, where the composer gate and pending-action bar offer
 * nothing to act on. The projection scans the same active conversation those
 * surfaces read and is persisted (and published to the session list) before a
 * runtime ever enters `paused`, so it is just as live.
 */
export function useSessionActivity(sessionId: string, persistedWaiting = false): SessionActivity {
  const generating = useSessionGenerating(sessionId)
  return useStore(sessionActivityStore, (state) => getSessionActivity(state, sessionId, generating, persistedWaiting))
}

export function resetSessionActivityStore(): void {
  sessionActivityStore.setState(initialState, true)
}
