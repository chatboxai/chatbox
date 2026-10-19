import { describe, expect, it } from 'vitest'
import { addSummaryRow, deriveMessageFacts, emptyThreadSummary } from './message-facts'
import type { Message } from '../types'

describe('last conversation message projection', () => {
  it('tracks a generating reply and ignores system, summary, and fork markers after it', () => {
    const messages: Message[] = [
      { id: 'user', role: 'user', contentParts: [] },
      { id: 'reply', role: 'assistant', generating: true, contentParts: [] },
      { id: 'system', role: 'system', contentParts: [] },
      { id: 'summary', role: 'user', isSummary: true, contentParts: [] },
      { id: 'marker', role: 'user', isForkMarker: true, contentParts: [] },
    ]
    let summary = emptyThreadSummary()
    for (const message of messages)
      summary = addSummaryRow(summary, {
        messageId: message.id,
        kind: message.isSummary ? 'summary' : 'message',
        status: message.generating ? 'generating' : 'settled',
        facts: deriveMessageFacts(message),
      })
    expect(summary.lastConversationMessageId).toBe('reply')
    expect(summary.lastNonSummaryMessageId).toBe('marker')
  })
})
