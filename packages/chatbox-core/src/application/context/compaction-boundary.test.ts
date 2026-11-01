import { describe, expect, it } from 'vitest'
import type { Message } from '../../types'
import { findLastCompactionBoundaryMessage } from './compaction-boundary'

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

describe('findLastCompactionBoundaryMessage', () => {
  it('selects the latest message across multiple rounds', () => {
    const boundary = findLastCompactionBoundaryMessage(conversation(4))
    expect(boundary?.id).toBe('a4')
  })

  it('selects the latest message in a two-round conversation', () => {
    const boundary = findLastCompactionBoundaryMessage(conversation(2))
    expect(boundary?.id).toBe('a2')
  })

  it('selects the latest message in a single round', () => {
    const boundary = findLastCompactionBoundaryMessage(conversation(1))
    expect(boundary?.id).toBe('a1')
  })

  it('never selects system or summary messages', () => {
    const messages = [message('sys', 'system'), message('u1', 'user'), message('a1', 'assistant')]
    expect(findLastCompactionBoundaryMessage(messages)?.id).toBe('a1')

    const summaryOnly = [message('sys', 'system'), message('sum', 'assistant', { isSummary: true })]
    expect(findLastCompactionBoundaryMessage(summaryOnly)).toBeUndefined()
  })

  it('advances past a previous summary standing at the head of context', () => {
    const contextAfterPreviousCompaction = [message('sum-1', 'assistant', { isSummary: true }), ...conversation(3)]
    const boundary = findLastCompactionBoundaryMessage(contextAfterPreviousCompaction)
    expect(boundary?.id).toBe('a3')
  })

  it('selects a latest user message and skips generating messages and fork markers', () => {
    const messages = [
      ...conversation(3),
      message('u4', 'user'),
      message('pending', 'assistant', { generating: true }),
      message('fork', 'assistant', { isForkMarker: true }),
    ]
    expect(findLastCompactionBoundaryMessage(messages)?.id).toBe('u4')
  })
})
