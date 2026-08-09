import { createMessage } from '@shared/types'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginSessionGeneration,
  cancelSessionGeneration,
  generationRuntimeStore,
  isSessionGenerating,
  resetSessionGenerationRuntime,
  settleSessionGeneration,
} from './session/generation-runtime'
import {
  clearSessionActivity,
  clearViewedSessionActivity,
  getSessionActivity,
  markSessionActivityViewed,
  markSessionReplyCompleted,
  resetSessionActivityStore,
  sessionActivityStore,
} from './sessionActivityStore'

function completedReply(id: string) {
  return { ...createMessage('assistant', 'Finished answer'), id, generating: false, finishReason: 'stop' }
}

function activity(sessionId: string) {
  return getSessionActivity(
    sessionActivityStore.getState(),
    sessionId,
    isSessionGenerating(generationRuntimeStore.getState(), sessionId)
  )
}

function complete(sessionId: string, messageId: string, message = completedReply(messageId)) {
  if (settleSessionGeneration(sessionId, messageId)) {
    markSessionReplyCompleted(sessionId, message)
  }
}

describe('sessionActivityStore', () => {
  beforeEach(() => {
    resetSessionGenerationRuntime()
    resetSessionActivityStore()
    markSessionActivityViewed('current-session')
  })

  it('shows generating while any reply in the session is active', () => {
    beginSessionGeneration('background-session', 'reply-1')
    beginSessionGeneration('background-session', 'reply-2')

    complete('background-session', 'reply-1')

    expect(activity('background-session')).toBe('generating')
  })

  it('marks a successful background completion unread after generation settles', () => {
    beginSessionGeneration('background-session', 'reply-1')
    complete('background-session', 'reply-1')

    expect(activity('background-session')).toBe('completed')
  })

  it('does not mark a completion unread while its session is open', () => {
    beginSessionGeneration('current-session', 'reply-1')
    complete('current-session', 'reply-1')

    expect(activity('current-session')).toBe('idle')
  })

  it('marks a completion unread after leaving its session', () => {
    beginSessionGeneration('current-session', 'reply-1')
    clearViewedSessionActivity('current-session')
    complete('current-session', 'reply-1')

    expect(activity('current-session')).toBe('completed')
  })

  it('does not mark canceled or failed replies as completed', () => {
    beginSessionGeneration('background-session', 'reply-1')
    complete('background-session', 'reply-1', {
      ...completedReply('reply-1'),
      contentParts: [],
      finishReason: 'canceled',
    })

    expect(activity('background-session')).toBe('idle')
  })

  it('clears unread completion when the session is viewed', () => {
    beginSessionGeneration('background-session', 'reply-1')
    complete('background-session', 'reply-1')

    markSessionActivityViewed('background-session')

    expect(activity('background-session')).toBe('idle')
  })

  it('removes canceled generation without creating a completion', () => {
    beginSessionGeneration('background-session', 'reply-1')

    cancelSessionGeneration('background-session', 'reply-1')

    expect(activity('background-session')).toBe('idle')
  })

  it('keeps the current session viewed when clearing its unread activity', () => {
    clearSessionActivity('current-session', { preserveViewedSession: true })
    beginSessionGeneration('current-session', 'reply-2')
    complete('current-session', 'reply-2')

    expect(sessionActivityStore.getState().viewedSessionId).toBe('current-session')
    expect(activity('current-session')).toBe('idle')
  })
})
