import type { Message } from '@shared/types'
import { describe, expect, test } from 'vitest'
import {
  describeUserMessageForAgentModeDecision,
  getLastUserMessage,
  isFirstUserTurn,
  parseAgentModeSuggestionDecision,
} from './agent-mode-suggestion'

function userMessage(text: string, extra?: Partial<Message>): Message {
  return {
    id: `u-${text}`,
    role: 'user',
    contentParts: [{ type: 'text', text }],
    ...extra,
  } as unknown as Message
}

function assistantMessage(text: string): Message {
  return {
    id: `a-${text}`,
    role: 'assistant',
    contentParts: [{ type: 'text', text }],
  } as unknown as Message
}

describe('parseAgentModeSuggestionDecision', () => {
  test('parses a plain JSON suggest=true object', () => {
    expect(parseAgentModeSuggestionDecision('{"suggest":true,"reason":"run code"}')).toEqual({
      suggest: true,
      reason: 'run code',
    })
  })

  test('parses suggest=false with empty reason', () => {
    expect(parseAgentModeSuggestionDecision('{"suggest":false,"reason":""}')).toEqual({
      suggest: false,
      reason: '',
    })
  })

  test('extracts JSON wrapped in markdown fences and prose', () => {
    const text = 'Sure, here is my decision:\n```json\n{"suggest": true, "reason": "needs tools"}\n```\nThanks!'
    expect(parseAgentModeSuggestionDecision(text)).toEqual({ suggest: true, reason: 'needs tools' })
  })

  test('omits reason when it is not a string', () => {
    expect(parseAgentModeSuggestionDecision('{"suggest":true,"reason":123}')).toEqual({
      suggest: true,
      reason: undefined,
    })
  })

  test('returns null when there is no JSON object', () => {
    expect(parseAgentModeSuggestionDecision('no json here')).toBeNull()
    expect(parseAgentModeSuggestionDecision('')).toBeNull()
  })

  test('returns null on invalid JSON', () => {
    expect(parseAgentModeSuggestionDecision('{"suggest": true,}')).toBeNull()
  })

  test('returns null when suggest is missing or not boolean', () => {
    expect(parseAgentModeSuggestionDecision('{"reason":"x"}')).toBeNull()
    expect(parseAgentModeSuggestionDecision('{"suggest":"yes"}')).toBeNull()
  })
})

describe('isFirstUserTurn', () => {
  test('true when exactly one user message precedes the target', () => {
    const messages = [userMessage('hi'), assistantMessage('reply')]
    expect(isFirstUserTurn(messages, 1)).toBe(true)
  })

  test('false when more than one user message precedes the target', () => {
    const messages = [userMessage('hi'), assistantMessage('reply'), userMessage('again'), assistantMessage('reply2')]
    expect(isFirstUserTurn(messages, 3)).toBe(false)
  })

  test('ignores messages at or after the target index', () => {
    const messages = [userMessage('hi'), userMessage('later')]
    expect(isFirstUserTurn(messages, 1)).toBe(true)
  })
})

describe('getLastUserMessage', () => {
  test('returns the nearest preceding user message', () => {
    const first = userMessage('first')
    const second = userMessage('second')
    const messages = [first, assistantMessage('reply'), second, assistantMessage('target-placeholder')]
    expect(getLastUserMessage(messages, 3)).toBe(second)
  })

  test('returns undefined when there is no preceding user message', () => {
    const messages = [assistantMessage('only assistant')]
    expect(getLastUserMessage(messages, 1)).toBeUndefined()
  })
})

describe('describeUserMessageForAgentModeDecision', () => {
  test('includes message text', () => {
    const result = describeUserMessageForAgentModeDecision(userMessage('Analyze this'))
    expect(result).toContain('User message:\nAnalyze this')
  })

  test('marks empty text as (empty)', () => {
    const result = describeUserMessageForAgentModeDecision(userMessage(''))
    expect(result).toContain('User message:\n(empty)')
  })

  test('lists attached files with their types', () => {
    const msg = userMessage('with files', {
      files: [
        { id: '1', name: 'a.csv', fileType: 'text/csv' },
        { id: '2', name: 'b.bin' },
      ],
    } as unknown as Partial<Message>)
    const result = describeUserMessageForAgentModeDecision(msg)
    expect(result).toContain('Attached files:')
    expect(result).toContain('- a.csv (text/csv)')
    expect(result).toContain('- b.bin')
  })

  test('lists attached links', () => {
    const msg = userMessage('with link', {
      links: [{ url: 'https://example.com' }],
    } as unknown as Partial<Message>)
    const result = describeUserMessageForAgentModeDecision(msg)
    expect(result).toContain('Attached links:')
    expect(result).toContain('- https://example.com')
  })
})
