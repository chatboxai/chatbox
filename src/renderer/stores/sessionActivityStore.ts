import type { Message } from '@shared/types'
import { createStore, useStore } from 'zustand'
import { router } from '@/router'
import { useSessionGenerating } from './session/generation-runtime'
import { isSuccessfulAssistantReply } from './session/message-success'

export type SessionActivity = 'idle' | 'generating' | 'completed'

type SessionActivityState = {
  unreadCompletedSessionIds: Record<string, true>
}

const initialState: SessionActivityState = {
  unreadCompletedSessionIds: {},
}

export const sessionActivityStore = createStore<SessionActivityState>(() => initialState)

function getViewedSessionId(): string | null {
  const match = router.state.location.pathname.match(/^\/session\/([^/]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export function markSessionReplyCompleted(sessionId: string, message: Message): void {
  if (!isSuccessfulAssistantReply(message)) return
  if (getViewedSessionId() === sessionId) return
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

export function useSessionActivity(sessionId: string): SessionActivity {
  const generating = useSessionGenerating(sessionId)
  return useStore(sessionActivityStore, (state) => getSessionActivity(state, sessionId, generating))
}

export function resetSessionActivityStore(): void {
  sessionActivityStore.setState(initialState, true)
}
