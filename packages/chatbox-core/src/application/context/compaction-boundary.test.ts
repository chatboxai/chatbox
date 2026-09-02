import { describe, expect, it } from 'vitest'
import type { Message } from '../../types'
import { findCompactionBoundaryMessage, findLastCompactionBoundaryMessage } from './compaction-boundary'

function message(id: string, role: Message['role'], overrides: Partial<Message> = {}): Message {
  return { id, role, contentParts: [{ type: 'text', text: id }], ...overrides }
}

function conversation(rounds: number): Message[] {
  const messages: Message[] = []
  for (let index = 1; index <= rounds; index += 1) {
    messages.push(message(`u${index}`, 'user'))
    messages.push(message(`a${index}`, 'assistant'))
  }
  return messages
}

describe('findCompactionBoundaryMessage', () => {
  it('keeps the last two rounds raw', () => {
    const boundary = findCompactionBoundaryMessage(conversation(4))
    expect(boundary?.id).toBe('a2')
  })

  it('falls back to one raw round when two are unaffordable', () => {
    const boundary = findCompactionBoundaryMessage(conversation(2))
    expect(boundary?.id).toBe('a1')
  })

  it('falls back to compacting through the last message for a single round', () => {
    const boundary = findCompactionBoundaryMessage(conversation(1))
    expect(boundary?.id).toBe('a1')
  })

  it('never selects system or summary messages', () => {
    const messages = [message('sys', 'system'), message('u1', 'user'), message('a1', 'assistant')]
    expect(findCompactionBoundaryMessage(messages)?.id).toBe('a1')

    const summaryOnly = [message('sys', 'system'), message('sum', 'assistant', { isSummary: true })]
    expect(findCompactionBoundaryMessage(summaryOnly)).toBeUndefined()
  })

  it('advances past a previous summary standing at the head of context', () => {
    const contextAfterPreviousCompaction = [message('sum-1', 'assistant', { isSummary: true }), ...conversation(3)]
    const boundary = findCompactionBoundaryMessage(contextAfterPreviousCompaction)
    expect(boundary?.id).toBe('a1')
  })

  it('shrinks the tail until it fits the token budget', () => {
    const estimateMessagesTokens = (messages: Message[]) => messages.length * 10

    // Two-round tail = 4 messages = 40 tokens: over a 25-token budget, so the
    // tail shrinks to one round (2 messages = 20 tokens) and the boundary moves
    // one round later.
    const boundary = findCompactionBoundaryMessage(conversation(4), {
      maxTailTokens: 25,
      estimateMessagesTokens,
    })
    expect(boundary?.id).toBe('a3')
  })

  it('falls back to compacting through the last message when even one round exceeds the budget', () => {
    const estimateMessagesTokens = (messages: Message[]) => messages.length * 10

    const boundary = findCompactionBoundaryMessage(conversation(4), {
      maxTailTokens: 5,
      estimateMessagesTokens,
    })
    expect(boundary?.id).toBe('a4')
  })
})

describe('findLastCompactionBoundaryMessage', () => {
  it('skips system messages', () => {
    expect(findLastCompactionBoundaryMessage([message('sys', 'system')])).toBeUndefined()
  })
})
