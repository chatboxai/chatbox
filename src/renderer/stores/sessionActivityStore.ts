import type { Message } from '@shared/types'
import { getDefaultStore } from 'jotai'
import { useSyncExternalStore } from 'react'
import { createStore, useStore } from 'zustand'
import { rendererApplication } from '@/app/renderer-application'
import { currentSessionIdAtom } from './atoms/sessionAtoms'
import { isSuccessfulAssistantReply } from './session/message-success'

const generationRuntimeStore = rendererApplication.generationRuntime

export type SessionActivity = 'idle' | 'generating' | 'completed'

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
  generating = false
): SessionActivity {
  if (generating) return 'generating'
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

export function useSessionActivity(sessionId: string): SessionActivity {
  const generating = useSessionGenerating(sessionId)
  return useStore(sessionActivityStore, (state) => getSessionActivity(state, sessionId, generating))
}

export function resetSessionActivityStore(): void {
  sessionActivityStore.setState(initialState, true)
}
