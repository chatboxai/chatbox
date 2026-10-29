import { describe, expect, it } from 'vitest'
import { contextPathFacts } from './context-path-facts'
import { addSummaryRow, deriveMessageFacts, emptyThreadSummary } from './message-facts'
import type { Message, MessageFile } from '../types'

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

describe('compaction summary attachment facts', () => {
  const report: MessageFile = { id: 'report', name: 'report.csv', fileType: 'text/csv', storageKey: 'parsed-report' }
  const indexed: MessageFile = {
    id: 'pdf',
    name: 'large.pdf',
    fileType: 'application/pdf',
    storageKey: 'parsed-pdf',
    ragMode: 'session-retrieval',
    sessionAttachmentId: 7,
  }
  const summary: Message = {
    id: 'summary',
    role: 'assistant',
    isSummary: true,
    contentParts: [{ type: 'text', text: 'Summary' }],
    compactedFiles: [report, indexed],
    compactedLinks: [{ id: 'link', url: 'https://example.com', title: 'Example', storageKey: 'parsed-link' }],
  }

  it('keeps referenced files readable, seeded and owned without counting the summary as a file message', () => {
    const facts = deriveMessageFacts(summary)
    expect(facts.hasFiles).toBe(false)
    expect(facts.fileResourceKeys).toEqual(['parsed-report', 'parsed-link'])
    expect(facts.seedAttachments?.map((seed) => seed.storageKey)).toEqual(['parsed-report', 'parsed-pdf'])
    expect(facts.attachmentOwnershipIds).toEqual([7])
  })

  it('seeds a file once when both its message and a summary reference it', () => {
    const facts = contextPathFacts([
      { id: 'user', role: 'user', contentParts: [], files: [report] },
      { id: 'reply', role: 'assistant', contentParts: [] },
      summary,
    ])
    expect(facts.sandboxSeedAttachments.map((seed) => seed.storageKey)).toEqual(['parsed-report', 'parsed-pdf'])
  })
})
