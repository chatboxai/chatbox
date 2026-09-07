import { encodeSessionTree } from '../session/session-tree/encode'
import type { SessionRowSnapshot } from '../ports/session-row-store'
import type { MessageRow } from '../session/session-tree/types'
import type { Session } from '../types/session'

export function expectedContextMessage(row: MessageRow) {
  return {
    sessionId: row.sessionId,
    threadId: row.threadId,
    messageId: row.messageId,
    parentMessageId: row.parentMessageId,
    seq: row.seq,
    message: row.message,
  }
}

export function contextSession(prefixCount = 8): Session {
  return {
    id: 'context-session',
    type: 'chat',
    name: 'Context',
    threadName: 'Active',
    messages: [
      { id: 'system', role: 'system', timestamp: 123, contentParts: [{ type: 'text', text: 'System instruction' }] },
      ...Array.from({ length: prefixCount }, (_, index) => ({
        id: `prefix-${index}`,
        role: index % 2 ? ('assistant' as const) : ('user' as const),
        contentParts: [{ type: 'text' as const, text: `Old payload ${index} ${'x'.repeat(1024)}` }],
      })),
      { id: 'boundary', role: 'assistant', contentParts: [{ type: 'text', text: 'Boundary' }] },
      { id: 'summary', role: 'assistant', isSummary: true, contentParts: [{ type: 'text', text: 'Summary' }] },
      { id: 'question', role: 'user', contentParts: [{ type: 'text', text: 'Question' }] },
      { id: 'target', role: 'assistant', generating: true, contentParts: [] },
    ],
    compactionPoints: [{ boundaryMessageId: 'boundary', summaryMessageId: 'summary', createdAt: 10 }],
  }
}

export function contextSnapshot(session = contextSession(), revision = 1): SessionRowSnapshot {
  const encoded = encodeSessionTree(session, { activeThreadId: session.id, now: 1 })
  if (!encoded.ok) throw new Error(encoded.reason)
  return {
    record: encoded.tree.session,
    revision,
    rows: { sessionId: session.id, threads: encoded.tree.threads, messages: encoded.tree.messages },
  }
}
