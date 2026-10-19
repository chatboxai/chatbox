import { addSummaryRow, deriveMessageFacts, emptyThreadSummary } from '../../session/message-facts'
import type { SessionRowSnapshot } from '../session-row-store'

/** Adds the persisted row projections to a structural test fixture. */
export function projectRowFixture(snapshot: SessionRowSnapshot): SessionRowSnapshot {
  const {
    presentation: _presentation,
    contextReadProjection: _context,
    topologyFingerprint: _fingerprint,
    forkCreatedAt: _forks,
    ...record
  } = snapshot.record
  snapshot.record = { ...record, rowFormatVersion: 3, rowAuthority: 1 }
  const byId = new Map(snapshot.rows.messages.map((row) => [row.messageId, row]))
  for (const row of snapshot.rows.messages) {
    row.facts = deriveMessageFacts(row.message)
    row.selected = false
  }
  for (const thread of snapshot.rows.threads) {
    const rows = snapshot.rows.messages.filter((row) => row.threadId === thread.threadId)
    thread.rootMessageId ??= rows.find((row) => row.parentMessageId === null)?.messageId ?? null
    let cursor = thread.rootMessageId
    let summary = emptyThreadSummary()
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const row = byId.get(cursor)
      if (!row || row.threadId !== thread.threadId) break
      row.selected = true
      summary = addSummaryRow(summary, { ...row, facts: row.facts! })
      thread.activeLeafMessageId = row.messageId
      cursor = row.activeChildId
    }
    thread.summary = summary
    thread.control = {
      generatingAssistantCount: rows.filter((row) => row.status === 'generating' && row.facts!.role === 'assistant')
        .length,
    }
  }
  return snapshot
}
