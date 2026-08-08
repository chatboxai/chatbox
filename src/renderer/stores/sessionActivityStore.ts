import type { Message } from '@shared/types'
import { createStore, useStore } from 'zustand'
import { isSuccessfulAssistantReply } from './session/message-success'

export type SessionActivity = 'idle' | 'generating' | 'completed'

type SessionActivityState = {
  viewedSessionId: string | null
  generatingMessageIdsBySession: Record<string, string[]>
  unreadCompletedSessionIds: Record<string, true>
}

const initialState: SessionActivityState = {
  viewedSessionId: null,
  generatingMessageIdsBySession: {},
  unreadCompletedSessionIds: {},
}

/** Runtime-only state: active streams do not survive an app restart. */
export const sessionActivityStore = createStore<SessionActivityState>(() => initialState)

/**
 * Keep sidebar activity in sync with assistant-message lifecycle updates.
 * A completion is marked unread only when this runtime observed the message
 * generating and the user was looking at another session when it succeeded.
 */
export function syncSessionGenerationActivity(sessionId: string, message: Message): void {
  if (message.role !== 'assistant') return

  sessionActivityStore.setState((state) => {
    const currentIds = state.generatingMessageIdsBySession[sessionId] ?? []

    if (message.generating) {
      if (currentIds.includes(message.id)) return state
      return {
        generatingMessageIdsBySession: {
          ...state.generatingMessageIdsBySession,
          [sessionId]: [...currentIds, message.id],
        },
      }
    }

    if (!currentIds.includes(message.id)) return state

    const remainingIds = currentIds.filter((id) => id !== message.id)
    const generatingMessageIdsBySession = { ...state.generatingMessageIdsBySession }
    if (remainingIds.length > 0) {
      generatingMessageIdsBySession[sessionId] = remainingIds
    } else {
      delete generatingMessageIdsBySession[sessionId]
    }

    const completedInBackground = state.viewedSessionId !== sessionId && isSuccessfulAssistantReply(message)

    return {
      generatingMessageIdsBySession,
      ...(completedInBackground
        ? {
            unreadCompletedSessionIds: {
              ...state.unreadCompletedSessionIds,
              [sessionId]: true as const,
            },
          }
        : {}),
    }
  })
}

export function clearMessageGenerationActivity(sessionId: string, messageId: string): void {
  sessionActivityStore.setState((state) => {
    const currentIds = state.generatingMessageIdsBySession[sessionId]
    if (!currentIds?.includes(messageId)) return state
    const remainingIds = currentIds.filter((id) => id !== messageId)
    const generatingMessageIdsBySession = { ...state.generatingMessageIdsBySession }
    if (remainingIds.length > 0) {
      generatingMessageIdsBySession[sessionId] = remainingIds
    } else {
      delete generatingMessageIdsBySession[sessionId]
    }
    return { generatingMessageIdsBySession }
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

export function clearSessionActivity(sessionId: string): void {
  sessionActivityStore.setState((state) => {
    const generatingMessageIdsBySession = { ...state.generatingMessageIdsBySession }
    const unreadCompletedSessionIds = { ...state.unreadCompletedSessionIds }
    delete generatingMessageIdsBySession[sessionId]
    delete unreadCompletedSessionIds[sessionId]
    return {
      ...(state.viewedSessionId === sessionId ? { viewedSessionId: null } : {}),
      generatingMessageIdsBySession,
      unreadCompletedSessionIds,
    }
  })
}

export function getSessionActivity(state: SessionActivityState, sessionId: string): SessionActivity {
  if (state.generatingMessageIdsBySession[sessionId]?.length) return 'generating'
  if (state.unreadCompletedSessionIds[sessionId]) return 'completed'
  return 'idle'
}

export function useSessionActivity(sessionId: string): SessionActivity {
  return useStore(sessionActivityStore, (state) => getSessionActivity(state, sessionId))
}

export function resetSessionActivityStore(): void {
  sessionActivityStore.setState(initialState, true)
}
