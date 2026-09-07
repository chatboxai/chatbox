import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import {
  hasConversationStarted,
  isActionAvailableInMode,
  isThreadHistoryAvailable,
  resolveSessionMode,
} from './mode-policy'

describe('resolveSessionMode', () => {
  it('maps on to work and everything else to chat', () => {
    expect(resolveSessionMode('on')).toBe('work')
    expect(resolveSessionMode('off')).toBe('chat')
    expect(resolveSessionMode('auto')).toBe('chat')
    expect(resolveSessionMode(undefined)).toBe('chat')
  })
})

describe('isActionAvailableInMode', () => {
  it('removes structural surgery and the session system prompt from work mode', () => {
    for (const action of [
      'reply-below',
      'edit-assistant-message',
      'delete-fork',
      'save-message-edit',
      'session-system-prompt',
      'create-thread',
      'thread-history',
    ] as const) {
      expect(isActionAvailableInMode(action, 'work')).toBe(false)
      expect(isActionAvailableInMode(action, 'chat')).toBe(true)
    }
  })

  it('keeps single-message delete available in both modes', () => {
    expect(isActionAvailableInMode('delete-message', 'work')).toBe(true)
    expect(isActionAvailableInMode('delete-message', 'chat')).toBe(true)
  })

  it('removes queueing and steering from chat mode', () => {
    for (const action of ['queue-message', 'steer-queued-message'] as const) {
      expect(isActionAvailableInMode(action, 'chat')).toBe(false)
      expect(isActionAvailableInMode(action, 'work')).toBe(true)
    }
  })
})

describe('isThreadHistoryAvailable', () => {
  it('keeps the empty history surface hidden in work mode', () => {
    expect(isThreadHistoryAvailable({ threads: undefined }, 'work')).toBe(false)
    expect(isThreadHistoryAvailable({ threads: [] }, 'work')).toBe(false)
  })

  it('shows stored thread boundaries in work mode', () => {
    expect(
      isThreadHistoryAvailable(
        {
          threads: [{ id: 't1', name: 'Earlier topic', createdAt: 1, messages: [] }],
        },
        'work'
      )
    ).toBe(true)
  })

  it('keeps thread history available in chat mode', () => {
    expect(isThreadHistoryAvailable({ threads: undefined }, 'chat')).toBe(true)
  })
})

describe('hasConversationStarted', () => {
  const user = { id: 'u1', role: 'user', contentParts: [] } as unknown as Session['messages'][number]
  const system = { id: 's1', role: 'system', contentParts: [] } as unknown as Session['messages'][number]

  it('ignores system-only sessions', () => {
    expect(hasConversationStarted({ messages: [system] })).toBe(false)
    expect(hasConversationStarted({ messages: [] })).toBe(false)
  })

  it('detects a user message on the active path', () => {
    expect(hasConversationStarted({ messages: [system, user] })).toBe(true)
  })

  it('detects exchanges archived into threads after clearing context', () => {
    expect(
      hasConversationStarted({
        messages: [system],
        threads: [{ id: 't1', name: '', createdAt: 0, messages: [user] }],
      })
    ).toBe(true)
  })
})
