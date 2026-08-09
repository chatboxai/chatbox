import type { Message } from '@shared/types'
import { createStore, useStore } from 'zustand'
import { useSessionGenerating } from './session/generation-runtime'
import { isSuccessfulAssistantReply } from './session/message-success'

export type SessionActivity = 'idle' | 'generating' | 'completed'

type SessionActivityState = {
  viewedSessionId: string | null
  unreadCompletedSessionIds: Record<string, true>
}

const initialState: SessionActivityState = {
  viewedSessionId: null,
  unreadCompletedSessionIds: {},
}

export const sessionActivityStore = createStore<SessionActivityState>(() => initialState)

export function markSessionReplyCompleted(sessionId: string, message: Message): void {
  if (!isSuccessfulAssistantReply(message)) return
  sessionActivityStore.setState((state) => {
    if (state.viewedSessionId === sessionId || state.unreadCompletedSessionIds[sessionId]) return state
    return {
      unreadCompletedSessionIds: {
        ...state.unreadCompletedSessionIds,
        [sessionId]: true,
      },
    }
  })
}

export function markSessionActivityViewed(sessionId: string): void {
  sessionActivityStore.setState((state) => {
    if (!state.unreadCompletedSessionIds[sessionId]) return { viewedSessionId: sessionId }
    const unreadCompletedSessionIds = { ...state.unreadCompletedSessionIds }
    delete unreadCompletedSessionIds[sessionId]
    return { viewedSessionId: sessionId, unreadCompletedSessionIds }
  })
}

export function clearViewedSessionActivity(sessionId: string): void {
  sessionActivityStore.setState((state) => (state.viewedSessionId === sessionId ? { viewedSessionId: null } : state))
}

export function clearSessionActivity(sessionId: string, options?: { preserveViewedSession?: boolean }): void {
  sessionActivityStore.setState((state) => {
    const unreadCompletedSessionIds = { ...state.unreadCompletedSessionIds }
    delete unreadCompletedSessionIds[sessionId]
    return {
      ...(state.viewedSessionId === sessionId && !options?.preserveViewedSession ? { viewedSessionId: null } : {}),
      unreadCompletedSessionIds,
    }
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

export function useSessionActivity(sessionId: string): SessionActivity {
  const generating = useSessionGenerating(sessionId)
  return useStore(sessionActivityStore, (state) => getSessionActivity(state, sessionId, generating))
}

export function resetSessionActivityStore(): void {
  sessionActivityStore.setState(initialState, true)
}
