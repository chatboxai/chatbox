import { createMessage } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { routerStateMock } = vi.hoisted(() => ({
  routerStateMock: { location: { pathname: '/session/current-session' } },
}))

vi.mock('@/router', () => ({ router: { state: routerStateMock } }))

import {
  beginSessionGeneration,
  generationRuntimeStore,
  isSessionGenerating,
  resetSessionGenerationRuntime,
  settleSessionGeneration,
} from './session/generation-runtime'
import {
  clearSessionActivity,
  getSessionActivity,
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

describe('sessionActivityStore', () => {
  beforeEach(() => {
    resetSessionGenerationRuntime()
    resetSessionActivityStore()
    routerStateMock.location.pathname = '/session/current-session'
  })

  it('shows generating while any reply in the session is active', () => {
    beginSessionGeneration('background-session')
    beginSessionGeneration('background-session')
    settleSessionGeneration('background-session')

    expect(activity('background-session')).toBe('generating')
  })

  it('marks a successful background completion unread after generation settles', () => {
    beginSessionGeneration('background-session')
    const message = completedReply('reply-1')
    settleSessionGeneration('background-session')
    markSessionReplyCompleted('background-session', message)

    expect(activity('background-session')).toBe('completed')
  })

  it('does not mark a completion unread for the current session', () => {
    beginSessionGeneration('current-session')
    settleSessionGeneration('current-session')
    markSessionReplyCompleted('current-session', completedReply('reply-1'))

    expect(activity('current-session')).toBe('idle')
  })

  it('marks a completion unread after leaving the session route', () => {
    routerStateMock.location.pathname = '/'
    beginSessionGeneration('current-session')
    settleSessionGeneration('current-session')
    markSessionReplyCompleted('current-session', completedReply('reply-1'))

    expect(activity('current-session')).toBe('completed')
  })

  it('does not mark a completion unread after directly routing into its session', () => {
    routerStateMock.location.pathname = '/session/background-session'
    beginSessionGeneration('background-session')
    settleSessionGeneration('background-session')
    markSessionReplyCompleted('background-session', completedReply('reply-1'))

    expect(activity('background-session')).toBe('idle')
  })

  it('clears unread completion when the session is opened', () => {
    beginSessionGeneration('background-session')
    settleSessionGeneration('background-session')
    markSessionReplyCompleted('background-session', completedReply('reply-1'))

    clearSessionActivity('background-session')

    expect(activity('background-session')).toBe('idle')
  })

  it('does not mark canceled or failed replies as completed', () => {
    beginSessionGeneration('background-session')
    settleSessionGeneration('background-session')
    markSessionReplyCompleted('background-session', {
      ...completedReply('reply-1'),
      contentParts: [],
      finishReason: 'canceled',
    })

    expect(activity('background-session')).toBe('idle')
  })
})
