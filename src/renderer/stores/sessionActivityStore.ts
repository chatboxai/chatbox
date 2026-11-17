import type { Message } from '@shared/types'
import { useSyncExternalStore } from 'react'
import { createStore, useStore } from 'zustand'
import { rendererApplication } from '@/app/renderer-application'
import { isSuccessfulAssistantReply } from './session/message-success'

const generationRuntimeStore = rendererApplication.generationRuntime

export type SessionActivity = 'idle' | 'generating' | 'waiting' | 'completed' | 'failed'

type UnreadOutcome = 'completed' | 'failed'

type SessionActivityState = {
  unreadSessionIds: Record<string, UnreadOutcome>
}

const initialState: SessionActivityState = {
  unreadSessionIds: {},
}

export const sessionActivityStore = createStore<SessionActivityState>(() => initialState)

let onScreenSessionId: string | null = null

/**
 * Set by the session route on enter and leave. The cached current session id
 * is not a substitute: it keeps pointing at the previous conversation after
 * New Chat.
 */
export function setOnScreenSession(sessionId: string | null): void {
  onScreenSessionId = sessionId
}

function isSessionOnScreen(sessionId: string): boolean {
  return onScreenSessionId === sessionId
}

function markSessionUnread(sessionId: string, outcome: UnreadOutcome): void {
  if (isSessionOnScreen(sessionId)) return
  sessionActivityStore.setState((state) => {
    if (state.unreadSessionIds[sessionId] === outcome) return state
    return {
      unreadSessionIds: {
        ...state.unreadSessionIds,
        [sessionId]: outcome,
      },
    }
  })
}

export function markSessionReplyCompleted(sessionId: string, message: Message): void {
  if (!isSuccessfulAssistantReply(message)) return
  markSessionUnread(sessionId, 'completed')
}

/** Gated on the field that renders the error card, so a failure dot always has a visible error behind it. */
export function markSessionReplyFailed(sessionId: string, message: Message): void {
  if (!message.error) return
  markSessionUnread(sessionId, 'failed')
}

export function clearSessionActivity(sessionId: string): void {
  sessionActivityStore.setState((state) => {
    if (!state.unreadSessionIds[sessionId]) return state
    const unreadSessionIds = { ...state.unreadSessionIds }
    delete unreadSessionIds[sessionId]
    return { unreadSessionIds }
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
  return state.unreadSessionIds[sessionId] ?? 'idle'
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
  onScreenSessionId = null
  sessionActivityStore.setState(initialState, true)
}
