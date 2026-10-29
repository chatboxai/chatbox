import { createMessage } from '@shared/types'
import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it } from 'vitest'

import { rendererApplication } from '@/app/renderer-application'
import { currentSessionIdAtom } from './atoms/sessionAtoms'
import {
  clearSessionActivity,
  getSessionActivity,
  isSessionGenerating,
  markSessionReplyCompleted,
  markSessionReplyFailed,
  resetSessionActivityStore,
  sessionActivityStore,
  setOnScreenSession,
} from './sessionActivityStore'

const generationRuntimeStore = rendererApplication.generationRuntime

function completedReply(id: string) {
  return { ...createMessage('assistant', 'Finished answer'), id, generating: false, finishReason: 'stop' }
}

function failedReply(id: string) {
  return { ...createMessage('assistant', ''), id, generating: false, error: 'provider failed' }
}

function activity(sessionId: string, persistedWaiting = false) {
  return getSessionActivity(
    sessionActivityStore.getState(),
    sessionId,
    isSessionGenerating(sessionId),
    persistedWaiting
  )
}

function startGeneration(sessionId: string, messageId = 'reply-1') {
  return generationRuntimeStore.start(sessionId, messageId)
}

function settleGeneration(sessionId: string, messageId = 'reply-1') {
  generationRuntimeStore.finishActive(sessionId, messageId)
}

describe('sessionActivityStore', () => {
  beforeEach(() => {
    generationRuntimeStore.clear('background-session')
    generationRuntimeStore.clear('current-session')
    resetSessionActivityStore()
    setOnScreenSession('current-session')
  })

  it('shows generating while any reply in the session is active', () => {
    startGeneration('background-session', 'reply-1')
    startGeneration('background-session', 'reply-2')
    settleGeneration('background-session', 'reply-1')

    expect(activity('background-session')).toBe('generating')
  })

  it('shows generating over waiting when a session mixes active and paused replies', () => {
    startGeneration('background-session', 'reply-1')
    const paused = startGeneration('background-session', 'reply-2')
    generationRuntimeStore.setPhase('background-session', paused.messageId, 'paused', paused)

    expect(activity('background-session', true)).toBe('generating')
  })

  it('does not treat a paused runtime as active generation', () => {
    const runtime = startGeneration('background-session')
    generationRuntimeStore.setPhase('background-session', runtime.messageId, 'paused', runtime)

    expect(activity('background-session', true)).toBe('waiting')
  })

  it('does not derive waiting from a paused runtime alone', () => {
    // A paused runtime can belong to an inactive fork branch with nothing to
    // act on; only the persisted active-conversation projection marks waiting.
    const runtime = startGeneration('background-session')
    generationRuntimeStore.setPhase('background-session', runtime.messageId, 'paused', runtime)

    expect(activity('background-session')).toBe('idle')
  })

  it('marks a successful background completion unread after generation settles', () => {
    startGeneration('background-session')
    const message = completedReply('reply-1')
    settleGeneration('background-session')
    markSessionReplyCompleted('background-session', message)

    expect(activity('background-session')).toBe('completed')
  })

  it('does not mark a completion unread for the current session', () => {
    startGeneration('current-session')
    settleGeneration('current-session')
    markSessionReplyCompleted('current-session', completedReply('reply-1'))

    expect(activity('current-session')).toBe('idle')
  })

  it('marks a completion unread after leaving the session route', () => {
    setOnScreenSession(null)
    startGeneration('current-session')
    settleGeneration('current-session')
    markSessionReplyCompleted('current-session', completedReply('reply-1'))

    expect(activity('current-session')).toBe('completed')
  })

  it('does not mark a completion unread after directly routing into its session', () => {
    setOnScreenSession('background-session')
    startGeneration('background-session')
    settleGeneration('background-session')
    markSessionReplyCompleted('background-session', completedReply('reply-1'))

    expect(activity('background-session')).toBe('idle')
  })

  it('marks a completion unread on New Chat while the cached session id still points at it', () => {
    setOnScreenSession(null)
    getDefaultStore().set(currentSessionIdAtom, 'current-session')
    startGeneration('current-session')
    settleGeneration('current-session')
    markSessionReplyCompleted('current-session', completedReply('reply-1'))

    expect(activity('current-session')).toBe('completed')
  })

  it('clears unread completion when the session is opened', () => {
    startGeneration('background-session')
    settleGeneration('background-session')
    markSessionReplyCompleted('background-session', completedReply('reply-1'))

    clearSessionActivity('background-session')

    expect(activity('background-session')).toBe('idle')
  })

  it('does not mark canceled or failed replies as completed', () => {
    startGeneration('background-session')
    settleGeneration('background-session')
    markSessionReplyCompleted('background-session', {
      ...completedReply('reply-1'),
      contentParts: [],
      finishReason: 'canceled',
    })

    expect(activity('background-session')).toBe('idle')
  })

  it('marks a background failure unread after generation settles', () => {
    startGeneration('background-session')
    settleGeneration('background-session')
    markSessionReplyFailed('background-session', failedReply('reply-1'))

    expect(activity('background-session')).toBe('failed')
  })

  it('does not mark a failure unread for the current session', () => {
    startGeneration('current-session')
    settleGeneration('current-session')
    markSessionReplyFailed('current-session', failedReply('reply-1'))

    expect(activity('current-session')).toBe('idle')
  })

  it('does not mark a failure unread without a visible error', () => {
    markSessionReplyFailed('background-session', { ...failedReply('reply-1'), error: undefined })

    expect(activity('background-session')).toBe('idle')
  })

  it('replaces an unread failure once a retry succeeds', () => {
    markSessionReplyFailed('background-session', failedReply('reply-1'))
    markSessionReplyCompleted('background-session', completedReply('reply-2'))

    expect(activity('background-session')).toBe('completed')
  })
})
