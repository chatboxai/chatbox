import { createMessage } from '@shared/types'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearMessageGenerationActivity,
  clearSessionActivity,
  clearViewedSessionActivity,
  getSessionActivity,
  markSessionActivityViewed,
  resetSessionActivityStore,
  sessionActivityStore,
  syncSessionGenerationActivity,
} from './sessionActivityStore'

function generatingReply(id: string) {
  return { ...createMessage('assistant', ''), id, generating: true }
}

function completedReply(id: string) {
  return { ...createMessage('assistant', 'Finished answer'), id, generating: false, finishReason: 'stop' }
}

describe('sessionActivityStore', () => {
  beforeEach(() => {
    resetSessionActivityStore()
    markSessionActivityViewed('current-session')
  })

  it('shows generating while any reply in the session is active', () => {
    syncSessionGenerationActivity('background-session', generatingReply('reply-1'))
    syncSessionGenerationActivity('background-session', generatingReply('reply-2'))

    syncSessionGenerationActivity('background-session', completedReply('reply-1'))

    expect(getSessionActivity(sessionActivityStore.getState(), 'background-session')).toBe('generating')
  })

  it('marks a successful background completion unread after generation settles', () => {
    syncSessionGenerationActivity('background-session', generatingReply('reply-1'))
    syncSessionGenerationActivity('background-session', completedReply('reply-1'))

    expect(getSessionActivity(sessionActivityStore.getState(), 'background-session')).toBe('completed')
  })

  it('does not mark a completion unread while its session is open', () => {
    syncSessionGenerationActivity('current-session', generatingReply('reply-1'))
    syncSessionGenerationActivity('current-session', completedReply('reply-1'))

    expect(getSessionActivity(sessionActivityStore.getState(), 'current-session')).toBe('idle')
  })

  it('marks a completion unread after leaving its session', () => {
    syncSessionGenerationActivity('current-session', generatingReply('reply-1'))
    clearViewedSessionActivity('current-session')
    syncSessionGenerationActivity('current-session', completedReply('reply-1'))

    expect(getSessionActivity(sessionActivityStore.getState(), 'current-session')).toBe('completed')
  })

  it('does not mark canceled or failed replies as completed', () => {
    const canceled = { ...completedReply('reply-1'), contentParts: [], finishReason: 'canceled' }
    syncSessionGenerationActivity('background-session', generatingReply('reply-1'))
    syncSessionGenerationActivity('background-session', canceled)

    expect(getSessionActivity(sessionActivityStore.getState(), 'background-session')).toBe('idle')
  })

  it('clears unread completion when the session is viewed', () => {
    syncSessionGenerationActivity('background-session', generatingReply('reply-1'))
    syncSessionGenerationActivity('background-session', completedReply('reply-1'))

    markSessionActivityViewed('background-session')

    expect(getSessionActivity(sessionActivityStore.getState(), 'background-session')).toBe('idle')
  })

  it('removes deleted generating messages without creating a completion', () => {
    syncSessionGenerationActivity('background-session', generatingReply('reply-1'))

    clearMessageGenerationActivity('background-session', 'reply-1')

    expect(getSessionActivity(sessionActivityStore.getState(), 'background-session')).toBe('idle')
  })

  it('keeps the current session viewed when clearing its message activity', () => {
    syncSessionGenerationActivity('current-session', generatingReply('reply-1'))

    clearSessionActivity('current-session', { preserveViewedSession: true })
    syncSessionGenerationActivity('current-session', generatingReply('reply-2'))
    syncSessionGenerationActivity('current-session', completedReply('reply-2'))

    expect(sessionActivityStore.getState().viewedSessionId).toBe('current-session')
    expect(getSessionActivity(sessionActivityStore.getState(), 'current-session')).toBe('idle')
  })
})
