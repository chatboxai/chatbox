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
  resetSessionActivityStore,
  sessionActivityStore,
} from './sessionActivityStore'

const generationRuntimeStore = rendererApplication.generationRuntime

function completedReply(id: string) {
  return { ...createMessage('assistant', 'Finished answer'), id, generating: false, finishReason: 'stop' }
}

function activity(sessionId: string) {
  return getSessionActivity(sessionActivityStore.getState(), sessionId, isSessionGenerating(sessionId))
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
    getDefaultStore().set(currentSessionIdAtom, 'current-session')
  })

  it('shows generating while any reply in the session is active', () => {
    startGeneration('background-session', 'reply-1')
    startGeneration('background-session', 'reply-2')
    settleGeneration('background-session', 'reply-1')

    expect(activity('background-session')).toBe('generating')
  })

  it('does not treat a paused runtime as active generation', () => {
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
    getDefaultStore().set(currentSessionIdAtom, null)
    startGeneration('current-session')
    settleGeneration('current-session')
    markSessionReplyCompleted('current-session', completedReply('reply-1'))

    expect(activity('current-session')).toBe('completed')
  })

  it('does not mark a completion unread after directly routing into its session', () => {
    getDefaultStore().set(currentSessionIdAtom, 'background-session')
    startGeneration('background-session')
    settleGeneration('background-session')
    markSessionReplyCompleted('background-session', completedReply('reply-1'))

    expect(activity('background-session')).toBe('idle')
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
})
