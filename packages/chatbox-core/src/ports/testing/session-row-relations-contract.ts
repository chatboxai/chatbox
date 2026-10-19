import { addSummaryRow, deriveMessageFacts, emptyThreadSummary } from '../../session/message-facts'
import type { SessionRowStoreContractCase, SessionRowStoreContractFactory } from './session-row-store-contract'
import { transcriptFixture } from './session-transcript-contract'

export function relationFixture() {
  const fixture = transcriptFixture()
  fixture.record = { ...fixture.record, rowFormatVersion: 3, rowAuthority: 1 }
  for (const row of fixture.rows.messages) {
    row.facts = deriveMessageFacts(row.message)
    row.selected = row.messageId !== 'inactive'
    row.seq = row.messageId === 'inactive' ? 1 : 0
  }
  fixture.rows.messages[0].forkCreatedAt = 42
  fixture.rows.messages[0].pendingBranchId = 'empty-fork'
  fixture.rows.messages[0].pendingBranchSeq = 2
  for (const thread of fixture.rows.threads) {
    thread.summary = emptyThreadSummary()
    thread.control = { generatingAssistantCount: 0 }
    for (const row of fixture.rows.messages.filter((row) => row.threadId === thread.threadId && row.selected))
      thread.summary = addSummaryRow(thread.summary, { ...row, facts: row.facts! })
  }
  return fixture
}
export function generatingRelationFixture() {
  const fixture = relationFixture()
  const base = fixture.rows.messages.find((row) => row.messageId === 'inactive')!
  for (let index = 0; index < 205; index++) {
    const messageId = `pending-${String(index).padStart(3, '0')}`
    const message = {
      id: messageId,
      role: 'assistant' as const,
      generating: true,
      contentParts: [{ type: 'text' as const, text: 'pending body' }],
    }
    fixture.rows.messages.push({
      ...base,
      messageId,
      status: 'generating',
      selected: false,
      seq: index + 3,
      branchId: `branch-${index}`,
      message,
      facts: deriveMessageFacts(message),
    })
  }
  const otherThread = fixture.rows.messages.find((row) => row.threadId === 'recent')!
  otherThread.status = 'generating'
  return fixture
}
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}
export function createSessionRowRelationsContract(
  factory: SessionRowStoreContractFactory
): SessionRowStoreContractCase[] {
  return [
    {
      name: 'pages generating metadata within one thread including inactive branches and fences continuation',
      run: async () => {
        const store = await factory()
        const fixture = generatingRelationFixture()
        await store.writeRows(fixture)
        const request = {
          sessionId: 'transcript',
          threadId: 'old',
          expectedRevision: 1,
          selector: { kind: 'status' as const, status: 'generating' as const },
          limit: 200,
        }
        const first = await store.readMessageRelationsPage(request)
        if (first?.status !== 'ready' || !first.nextCursor) throw new Error('Expected status continuation')
        equal(first.rows.length, 200)
        equal(
          first.rows.every((row) => row.status === 'generating' && !row.selected && row.threadId === 'old'),
          true
        )
        const second = await store.readMessageRelationsPage({ ...request, cursor: first.nextCursor })
        if (second?.status !== 'ready') throw new Error('Expected status page')
        equal(
          second.rows.map((row) => row.messageId),
          ['pending-200', 'pending-201', 'pending-202', 'pending-203', 'pending-204']
        )
        equal(second.nextCursor, null)
        const empty = await store.readMessageRelationsPage({ ...request, threadId: 'missing' })
        if (empty?.status !== 'ready') throw new Error('Expected empty status page')
        equal(empty.rows, [])
        fixture.revision = 2
        for (const row of fixture.rows.messages) if (row.threadId === 'old') row.status = 'settled'
        await store.writeRows(fixture)
        let conflict = false
        try {
          await store.readMessageRelationsPage({ ...request, cursor: first.nextCursor })
        } catch (error) {
          conflict = error instanceof Error && error.name === 'SessionRowConflictError'
        }
        equal(conflict, true)
        const settled = await store.readMessageRelationsPage({ ...request, expectedRevision: 2 })
        if (settled?.status !== 'ready') throw new Error('Expected settled status page')
        equal(settled.rows, [])
      },
    },

    {
      name: 'pages selected paused metadata independently of the body window',
      run: async () => {
        const store = await factory()
        const fixture = relationFixture()
        for (const row of fixture.rows.messages)
          if (['old-1', 'old-2', 'inactive'].includes(row.messageId)) row.facts!.paused = true
        await store.writeRows(fixture)
        const request = {
          sessionId: 'transcript',
          threadId: 'old',
          expectedRevision: 1,
          selector: { kind: 'selected-facts' as const, paused: true as const },
          limit: 1,
        }
        const first = await store.readMessageRelationsPage(request)
        if (first?.status !== 'ready' || !first.nextCursor) throw new Error('Expected paused metadata continuation')
        equal(
          first.rows.map((r) => r.messageId),
          ['old-1']
        )
        const second = await store.readMessageRelationsPage({ ...request, cursor: first.nextCursor })
        if (second?.status !== 'ready') throw new Error('Expected paused metadata page')
        equal(
          second.rows.map((r) => r.messageId),
          ['old-2']
        )
        equal(second.nextCursor, null)
      },
    },
    {
      name: 'reads row facts by identity and retains fork identities without payload reads',
      run: async () => {
        const store = await factory()
        await store.writeRows(relationFixture())
        const result = await store.readMessageMetadata({
          sessionId: 'transcript',
          messageIds: ['old-0', 'missing', 'old-0', 'inactive'],
          expectedRevision: 1,
        })
        if (result?.status !== 'ready') throw new Error('Expected known metadata')
        equal(
          result.rows.map((row) => [row.messageId, row.selected, row.facts.role]),
          [
            ['old-0', true, 'user'],
            ['inactive', false, 'assistant'],
          ]
        )
        equal(result.missingMessageIds, ['missing'])
        equal(result.rows[0].forkCreatedAt, 42)
        equal(result.rows[0].pendingBranchId, 'empty-fork')
      },
    },
    {
      name: 'pages children in sibling rank and follows paths independently of sibling ranks',
      run: async () => {
        const store = await factory()
        await store.writeRows(relationFixture())
        const request = {
          sessionId: 'transcript',
          threadId: 'old',
          expectedRevision: 1,
          limit: 1,
          selector: { kind: 'children' as const, parentMessageId: 'old-0' },
        }
        const first = await store.readMessageRelationsPage(request)
        if (first?.status !== 'ready' || !first.nextCursor) throw new Error('Expected continuation')
        equal(
          first.rows.map((r) => r.messageId),
          ['old-1']
        )
        const second = await store.readMessageRelationsPage({ ...request, cursor: first.nextCursor })
        if (second?.status !== 'ready') throw new Error('Expected page')
        equal(
          second.rows.map((r) => r.messageId),
          ['inactive']
        )
        const reverse = await store.readMessageRelationsPage({
          ...request,
          selector: { ...request.selector, reverse: true, boundary: { seq: 1, messageId: 'inactive' } },
        })
        if (reverse?.status !== 'ready') throw new Error('Expected reverse page')
        equal(
          reverse.rows.map((r) => r.messageId),
          ['old-1']
        )
        const path = await store.readMessageRelationsPage({
          ...request,
          limit: 20,
          selector: { kind: 'selected-path', messageId: 'old-0' },
        })
        if (path?.status !== 'ready') throw new Error('Expected selected path')
        equal(
          path.rows.map((r) => r.messageId),
          ['old-0', 'old-1', 'old-2']
        )
        const transcript = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: { messageId: 'old-1' },
          limit: 2,
          expectedRevision: 1,
        })
        equal(
          transcript?.messages.map((r) => r.messageId),
          ['old-1', 'old-2']
        )
      },
    },
    {
      name: 'reads thread summaries and reports missing row projections explicitly',
      run: async () => {
        const store = await factory()
        await store.writeRows(relationFixture())
        const page = await store.readThreadSummariesPage({ sessionId: 'transcript', limit: 2 })
        equal(
          page?.threads.map((t) => [t.threadId, t.summary?.messageCount]),
          [
            ['active', 3],
            ['recent', 4],
          ]
        )
        const thread = await store.readThreadState({ sessionId: 'transcript', threadId: 'old', expectedRevision: 1 })
        if (thread?.status !== 'ready') throw new Error('Expected known thread summary')
        equal(thread.thread.summary.messageCount, 3)
        const legacy = transcriptFixture()
        legacy.record.rowFormatVersion = undefined
        for (const row of legacy.rows.messages) {
          delete row.facts
          delete row.selected
        }
        await store.writeRows({ ...legacy, revision: 2 }, 1)
        const missing = await store.readMessageMetadata({
          sessionId: 'transcript',
          messageIds: ['old-0'],
          expectedRevision: 2,
        })
        equal(missing?.status, 'projection-unavailable')
      },
    },
  ]
}
