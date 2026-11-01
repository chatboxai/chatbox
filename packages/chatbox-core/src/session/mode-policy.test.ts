import { describe, expect, it } from 'vitest'
import { isActionAvailableInMode, resolveSessionMode, shouldRestrictMessageEditToLastOutput } from './mode-policy'

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

  it('keeps assistant message editing available in both modes', () => {
    expect(isActionAvailableInMode('edit-assistant-message', 'work')).toBe(true)
    expect(isActionAvailableInMode('edit-assistant-message', 'chat')).toBe(true)
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

describe('shouldRestrictMessageEditToLastOutput', () => {
  it('limits work-mode assistant and system edits to the last output text', () => {
    expect(shouldRestrictMessageEditToLastOutput('work', 'assistant')).toBe(true)
    expect(shouldRestrictMessageEditToLastOutput('work', 'system')).toBe(true)
    expect(shouldRestrictMessageEditToLastOutput('work', 'user')).toBe(false)
  })

  it('leaves chat-mode edits unrestricted', () => {
    expect(shouldRestrictMessageEditToLastOutput('chat', 'assistant')).toBe(false)
    expect(shouldRestrictMessageEditToLastOutput('chat', 'user')).toBe(false)
  })
})
