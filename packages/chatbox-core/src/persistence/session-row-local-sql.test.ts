import { afterEach, describe, expect, it, vi } from 'vitest'
import { RowBackedSessionRepository } from '../application/session/RowBackedSessionRepository'
import { SessionRowWriteQueue } from '../application/session/SessionRowWriteQueue'
import { InMemorySessionRecordStore } from './memory-session-record-store'
import type { Message } from '../types'
import type { MessageRow, MessageRowMetadata } from '../session/session-tree/types'
import type { SessionRowsDiff, SessionRowStorePort } from '../ports/session-row-store'
import { relationFixture } from '../ports/testing/session-row-relations-contract'
import { InMemorySessionRowStore } from '../testing/InMemorySessionRowStore'
import { SqlSessionRowStore } from './session-row-sql'
import { openNodeSessionRowDatabase, type NodeSessionRowSqlDatabase } from './node-sqlite.test-support'
const databases: NodeSessionRowSqlDatabase[] = []
function sqlStore() {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  return { database, store: new SqlSessionRowStore(database, undefined, { readByteBudget: 'none' }) }
}
afterEach(() => {
  vi.restoreAllMocks()
  while (databases.length) databases.pop()?.close()
})
function metadata(row: MessageRow): MessageRowMetadata {
  const { message, ...rest } = row
  return rest
}
function emptyDiff(): SessionRowsDiff {
  return { sessionId: 'transcript', threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: [] } }
}
function forkFixture(extraBranches = 0) {
  const fixture = relationFixture()
  const point = fixture.rows.messages.find((row) => row.messageId === 'old-0')!
  const selected = fixture.rows.messages.find((row) => row.messageId === 'old-1')!
  const inactive = fixture.rows.messages.find((row) => row.messageId === 'inactive')!
  point.forkPivotId = point.messageId
  selected.branchId = 'original'
  point.fork = {
    pivotId: point.messageId,
    branchPointId: point.messageId,
    selectedBranchId: 'original',
    count: 3 + extraBranches,
    position: 0,
  }
  for (let index = 0; index < extraBranches; index++) {
    const id = `extra-${index}`
    fixture.rows.messages.push({
      ...inactive,
      messageId: id,
      branchId: id,
      seq: index + 3,
      message: { ...inactive.message, id },
    })
  }
  return { fixture, point, selected, inactive }
}
for (const [name, factory] of [
  ['SQL', () => sqlStore().store],
  ['memory', () => new InMemorySessionRowStore()],
] as const)
  describe(`${name} local row publication`, () => {
    async function setup() {
      const store: SessionRowStorePort = factory()
      const fixture = relationFixture()
      await store.writeRows(fixture)
      return { store, fixture, commit: { record: fixture.record, revision: 2 } }
    }
    it('updates one body and returns the committed summary directly', async () => {
      const { store, fixture, commit } = await setup()
      const row = fixture.rows.messages.find((r) => r.messageId === 'old-2')!
      const result = await store.applyDiff(
        {
          ...emptyDiff(),
          messages: {
            upsert: [
              {
                ...row,
                message: { ...row.message, role: 'assistant', contentParts: [{ type: 'text', text: 'edited' }] },
              },
            ],
            delete: [],
          },
        },
        commit,
        1
      )
      expect(result.messageMetadata.map((row) => row.messageId)).toEqual(['old-2'])
      expect(result.messageMetadata[0].facts?.role).toBe('assistant')
      expect(result.messageMetadata[0]).not.toHaveProperty('message')
      expect(result.threads.find((t) => t.threadId === 'old')?.summary).toMatchObject({
        messageCount: 3,
        userMessageCount: 1,
        assistantMessageCount: 2,
      })
      expect(result.threads.find((t) => t.threadId === 'active')?.summary?.messageCount).toBe(3)
      expect(
        (await store.readTranscriptWindow({ sessionId: 'transcript', origin: { messageId: 'old-2' }, limit: 1 }))
          ?.messages[0].message.contentParts
      ).toEqual([{ type: 'text', text: 'edited' }])
    })
    it('preserves fork projections on body edits and refreshes changed branch selection and identity', async () => {
      const store: SessionRowStorePort = factory()
      const { fixture, point, selected, inactive } = forkFixture()
      await store.writeRows(fixture)
      await store.applyDiff(
        {
          ...emptyDiff(),
          messages: {
            upsert: [
              { ...selected, message: { ...selected.message, contentParts: [{ type: 'text', text: 'checkpoint' }] } },
            ],
            delete: [],
          },
        },
        { record: fixture.record, revision: 2 },
        1
      )
      const readFork = async (expectedRevision: number) => {
        const read = await store.readMessageMetadata({
          sessionId: 'transcript',
          messageIds: [point.messageId],
          expectedRevision,
        })
        if (read?.status !== 'ready') throw new Error('Fork metadata missing')
        return read.rows[0].fork
      }
      expect(await readFork(2)).toEqual(point.fork)
      await store.applyDiff(
        {
          ...emptyDiff(),
          messageMetadataUpsert: [{ ...metadata(point), activeChildId: inactive.messageId }],
        },
        { record: fixture.record, revision: 3 },
        2
      )
      expect(await readFork(3)).toMatchObject({ count: 3, position: 1, selectedBranchId: inactive.branchId })
      await store.applyDiff(
        {
          ...emptyDiff(),
          messageMetadataUpsert: [{ ...metadata(inactive), branchId: 'renamed' }],
        },
        { record: fixture.record, revision: 4 },
        3
      )
      expect(await readFork(4)).toMatchObject({ count: 3, position: 1, selectedBranchId: 'renamed' })
    })
    it.each([false, true])(
      'returns the committed pivot after leaving an empty branch (summary=%s)',
      async (summaryPoint) => {
        const store = factory()
        const repository = new RowBackedSessionRepository({
          rows: store,
          backup: store,
          records: new InMemorySessionRecordStore(),
          writes: new SessionRowWriteQueue((_id, run) => run()),
        })
        const message = (id: string, role: Message['role'] = 'assistant'): Message => ({
          id,
          role,
          contentParts: [{ type: 'text', text: id }],
        })
        await repository.createSessionRows({ id: 's', name: 'Rows' }, [
          message('user', 'user'),
          ...(summaryPoint ? [{ ...message('summary'), isSummary: true }] : []),
          message('reply'),
        ])
        for (const [newListId, append] of [
          ['alternative', [message('alternative-reply')]],
          ['empty', []],
        ] as const)
          await repository.executeSessionCommand('s', {
            type: 'structure',
            operation: {
              action: 'fork-create',
              pivotId: 'user',
              append: [...append],
              identity: { seedListId: 'seed', storedListId: 'original', newListId, createdAt: 42 },
            },
          })
        const bodies = vi.spyOn(store, 'readMessages')
        const query = name === 'SQL' ? vi.spyOn(databases.at(-1)!, 'query') : undefined
        const result = await repository.executeSessionCommand('s', {
          type: 'structure',
          operation: { action: 'fork-switch', pivotId: 'user', target: 'prev' },
        })
        const published = result.delta.diff.messageMetadataUpsert!
        expect(published.map((row) => row.messageId).sort()).toEqual(summaryPoint ? ['summary', 'user'] : ['user'])
        expect(published.find((row) => row.messageId === 'user')?.fork).toMatchObject({
          pivotId: 'user',
          branchPointId: summaryPoint ? 'summary' : 'user',
          selectedBranchId: 'fork_list_alternative',
          count: 2,
          position: 1,
        })
        const point = published.find((row) => row.messageId === (summaryPoint ? 'summary' : 'user'))!
        expect(point.activeChildId).toBe('alternative-reply')
        expect(point.pendingBranchId).toBeUndefined()
        expect(point.pendingBranchSeq).toBeUndefined()
        expect(published.every((row) => !('message' in row) && !('selectedDepth' in row))).toBe(true)
        expect(bodies).not.toHaveBeenCalled()
        expect(query?.mock.calls.some(([sql]) => sql.includes('session_message_payload_chunks')) ?? false).toBe(false)
        const committed = await store.readMessageMetadata({
          sessionId: 's',
          messageIds: ['user'],
          expectedRevision: result.delta.revision,
        })
        expect(committed?.status === 'ready' && committed.rows[0].fork).toEqual(
          published.find((row) => row.messageId === 'user')?.fork
        )
      }
    )
    it('keeps a generating body checkpoint out of structural metadata events', async () => {
      const store = factory()
      const repository = new RowBackedSessionRepository({
        rows: store,
        backup: store,
        records: new InMemorySessionRecordStore(),
        writes: new SessionRowWriteQueue((_id, run) => run()),
      })
      await repository.createSessionRows({ id: 's', name: 'Rows' }, [
        {
          id: 'reply',
          role: 'assistant',
          contentParts: [{ type: 'text', text: 'partial' }],
          generating: true,
        },
      ])
      const result = await repository.executeSessionCommand('s', {
        type: 'update',
        messageId: 'reply',
        updater: { contentParts: [{ type: 'text', text: 'more text' }] },
      })
      expect(result.delta.diff.messageMetadataUpsert).toEqual([])
      expect(result.delta.diff.messages.upsert).toHaveLength(1)
      expect(result.delta.diff.messages.upsert[0]).toMatchObject({
        status: 'generating',
        facts: { contextEligible: false },
        message: { contentParts: [{ type: 'text', text: 'more text' }] },
      })
    })
    it('omits a point write deleted by the same publication', async () => {
      const { store, fixture, commit } = await setup()
      const leaf = fixture.rows.messages.find((row) => row.messageId === 'old-2')!
      const parent = fixture.rows.messages.find((row) => row.messageId === 'old-1')!
      const result = await store.applyDiff(
        {
          ...emptyDiff(),
          messageMetadataUpsert: [{ ...metadata(parent), activeChildId: null }],
          messages: { upsert: [leaf], delete: [leaf.messageId] },
        },
        commit,
        1
      )
      expect(result.messageMetadata.map((row) => row.messageId)).toEqual([parent.messageId])
      expect(result.messageMetadata[0]).toMatchObject({ activeChildId: null, selected: true })
    })
    it('refreshes naming eligibility when a reply becomes an error', async () => {
      const { store, fixture, commit } = await setup()
      const row = fixture.rows.messages.find((row) => row.messageId === 'active-1')!
      const result = await store.applyDiff(
        {
          ...emptyDiff(),
          messages: { upsert: [{ ...row, message: { ...row.message, error: 'failed' } }], delete: [] },
        },
        commit,
        1
      )
      expect(result.threads.find((t) => t.threadId === 'active')?.summary).toMatchObject({
        firstNamingUserMessageId: 'active-0',
        hasAutoTitleContent: false,
      })
    })
    it('inserts a shared parent while preserving sibling ranks and inactive branches', async () => {
      const { store, fixture, commit } = await setup()
      const point = fixture.rows.messages.find((row) => row.messageId === 'old-0')!
      const summary: MessageRow = {
        ...point,
        messageId: 'summary',
        parentMessageId: point.messageId,
        kind: 'summary',
        message: {
          id: 'summary',
          role: 'assistant',
          isSummary: true,
          contentParts: [{ type: 'text', text: 'summary' }],
        },
      }
      const result = await store.applyDiff(
        {
          ...emptyDiff(),
          insertParents: [{ threadId: 'old', parentMessageId: point.messageId, newParentMessageId: 'summary' }],
          messageMetadataUpsert: [{ ...metadata(point), activeChildId: 'summary' }],
          messages: { upsert: [summary], delete: [] },
        },
        commit,
        1
      )
      expect(result.threads.find((t) => t.threadId === 'old')?.summary?.messageCount).toBe(4)
      const rows = await store.readMessageMetadata({
        sessionId: 'transcript',
        messageIds: ['old-1', 'inactive'],
        expectedRevision: 2,
      })
      expect(rows?.status === 'ready' && rows.rows.map((row) => [row.parentMessageId, row.seq, row.selected])).toEqual([
        ['summary', 0, true],
        ['summary', 1, false],
      ])
    })
    it('updates the recent conversation identity when the last row becomes a fork marker', async () => {
      const { store, fixture, commit } = await setup()
      const target = fixture.rows.messages.find((r) => r.messageId === 'active-2')!
      const result = await store.applyDiff(
        {
          ...emptyDiff(),
          messages: { upsert: [{ ...target, message: { ...target.message, isForkMarker: true } }], delete: [] },
        },
        commit,
        1
      )
      expect(result.threads.find((t) => t.threadId === 'active')?.summary?.lastConversationMessageId).toBe('active-1')
    })
    it('appends using parent edges while keeping sibling ranks local', async () => {
      const { store, fixture, commit } = await setup()
      const tail = fixture.rows.messages.find((r) => r.messageId === 'active-2')!
      const next: MessageRow = {
        ...tail,
        messageId: 'next',
        parentMessageId: tail.messageId,
        activeChildId: null,
        seq: 0,
        status: 'generating',
        message: { id: 'next', role: 'assistant', contentParts: [] },
      }
      const result = await store.applyDiff(
        {
          ...emptyDiff(),
          messageMetadataUpsert: [{ ...metadata(tail), activeChildId: 'next' }],
          messages: { upsert: [next], delete: [] },
        },
        commit,
        1
      )
      expect(result.threads.find((t) => t.threadId === 'active')).toMatchObject({
        activeLeafMessageId: 'next',
        summary: { messageCount: 4, generatingMessageCount: 1 },
        control: { generatingAssistantCount: 1 },
      })
      const selected = await store.readMessageMetadata({
        sessionId: 'transcript',
        messageIds: ['next'],
        expectedRevision: 2,
      })
      expect(selected?.status === 'ready' && selected.rows[0].selected).toBe(true)
    })
    it('changes only the selected suffix and keeps inactive body rows', async () => {
      const { store, fixture, commit } = await setup()
      const point = fixture.rows.messages.find((r) => r.messageId === 'old-0')!
      const result = await store.applyDiff(
        {
          ...emptyDiff(),
          messageMetadataUpsert: [
            { ...metadata(point), activeChildId: 'inactive', pendingBranchId: undefined, pendingBranchSeq: undefined },
          ],
        },
        commit,
        1
      )
      expect(result.threads.find((t) => t.threadId === 'old')).toMatchObject({
        activeLeafMessageId: 'inactive',
        summary: { messageCount: 2, userMessageCount: 1, assistantMessageCount: 1 },
      })
      const rows = await store.readMessageMetadata({
        sessionId: 'transcript',
        messageIds: ['old-1', 'old-2', 'inactive'],
        expectedRevision: 2,
      })
      expect(rows?.status === 'ready' && rows.rows.map((r) => r.selected)).toEqual([false, false, true])
      const branch = await store.readBranchMessagesPage({
        sessionId: 'transcript',
        firstMessageId: 'old-1',
        limit: 20,
        expectedRevision: 2,
      })
      expect(branch?.messages.map((r) => r.messageId)).toEqual(['old-1', 'old-2'])
    })
    it('deletes an inactive subtree without changing selected-path counts', async () => {
      const { store, commit } = await setup()
      const result = await store.applyDiff(
        { ...emptyDiff(), deleteSubtrees: [{ threadId: 'old', rootMessageId: 'inactive' }] },
        commit,
        1
      )
      expect(result.threads.find((t) => t.threadId === 'old')?.summary?.messageCount).toBe(3)
      const row = await store.readMessageMetadata({
        sessionId: 'transcript',
        messageIds: ['inactive'],
        expectedRevision: 2,
      })
      expect(row?.status === 'ready' && row.missingMessageIds).toEqual(['inactive'])
    })
    it('collapses a pivot through metadata ranges', async () => {
      const { store, fixture, commit } = await setup()
      const point = fixture.rows.messages.find((r) => r.messageId === 'old-0')!
      const result = await store.applyDiff(
        {
          ...emptyDiff(),
          messageMetadataUpsert: [{ ...metadata(point), activeChildId: 'old-2' }],
          messages: { upsert: [], delete: ['old-1'] },
          reparentChildren: [{ threadId: 'old', parentMessageId: 'old-1', newParentMessageId: 'old-0', seqOffset: 0 }],
        },
        commit,
        1
      )
      expect(result.threads.find((t) => t.threadId === 'old')).toMatchObject({
        activeLeafMessageId: 'old-2',
        summary: { messageCount: 2, userMessageCount: 2 },
      })
      expect(
        (
          await store.readTranscriptWindow({
            sessionId: 'transcript',
            origin: { threadId: 'old', edge: 'head' },
            limit: 20,
          })
        )?.messages.map((r) => r.messageId)
      ).toEqual(['old-0', 'old-2', 'recent-0', 'recent-1', 'recent-2', 'recent-3', 'active-0', 'active-1', 'active-2'])
    })
    it('clears messages and archived threads atomically', async () => {
      const { store, fixture, commit } = await setup()
      const active = fixture.rows.threads.find((t) => t.threadId === 'active')!
      const result = await store.applyDiff(
        {
          ...emptyDiff(),
          deleteSessionMessages: true,
          deleteArchivedThreads: true,
          threads: { upsert: [{ ...active, rootMessageId: null, activeLeafMessageId: null }], delete: [] },
        },
        commit,
        1
      )
      expect(result.threads).toHaveLength(1)
      expect(result.threads[0].summary?.messageCount).toBe(0)
      expect(
        (await store.readThreadSummariesPage({ sessionId: 'transcript', limit: 20 }))?.threads.map((t) => t.threadId)
      ).toEqual(['active'])
      expect(
        (await store.readTranscriptWindow({ sessionId: 'transcript', origin: 'tail', limit: 20 }))?.messages
      ).toEqual([])
    })
    it('rejects broken edges without publishing partial projections', async () => {
      const { store, fixture, commit } = await setup()
      const point = fixture.rows.messages.find((r) => r.messageId === 'old-0')!
      await expect(
        store.applyDiff(
          { ...emptyDiff(), messageMetadataUpsert: [{ ...metadata(point), activeChildId: 'old-2' }] },
          commit,
          1
        )
      ).rejects.toThrow()
      expect((await store.readCommit('transcript'))?.revision).toBe(1)
      expect(
        (
          await store.readTranscriptWindow({ sessionId: 'transcript', origin: { messageId: 'old-1' }, limit: 2 })
        )?.messages.map((r) => r.messageId)
      ).toEqual(['old-1', 'old-2'])
    })
  })
it('repairs branch projections using metadata without hydrating committed bodies', async () => {
  const { database, store } = sqlStore()
  const fixture = relationFixture()
  await store.writeRows(fixture)
  const query = vi.spyOn(database, 'query')
  const point = fixture.rows.messages.find((r) => r.messageId === 'old-0')!
  await store.applyDiff(
    { ...emptyDiff(), messageMetadataUpsert: [{ ...metadata(point), activeChildId: 'inactive' }] },
    { record: fixture.record, revision: 2 },
    1
  )
  expect(query.mock.calls.map(([sql]) => sql).join('\n')).not.toContain('session_message_payload_chunks')
  expect(
    (await database.query<{ count: number }>('SELECT COUNT(*) AS count FROM session_messages_staging'))[0].count
  ).toBe(0)
})

it('slices large row metadata for bounded reads and staged metadata edits', async () => {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const store = new SqlSessionRowStore(database)
  const fixture = relationFixture()
  const point = fixture.rows.messages.find((r) => r.messageId === 'old-0')!
  point.facts!.seedAttachments = [{ name: '附件🧩'.repeat(8000), storageKey: 'seed' }]
  await store.writeRows(fixture)
  const original = database.query.bind(database)
  const reads: number[] = []
  vi.spyOn(database, 'query').mockImplementation(async (sql, params) => {
    const result = await original(sql, params)
    reads.push(new TextEncoder().encode(JSON.stringify(result)).length)
    return result
  })
  await store.applyDiff(
    { ...emptyDiff(), messageMetadataUpsert: [{ ...metadata(point), activeChildId: 'inactive' }] },
    { record: fixture.record, revision: 2 },
    1
  )
  const result = await store.readMessageMetadata({
    sessionId: 'transcript',
    messageIds: ['old-0'],
    expectedRevision: 2,
  })
  expect(result?.status === 'ready' && result.rows[0].facts.seedAttachments).toEqual(point.facts!.seedAttachments)
  expect(Math.max(...reads)).toBeLessThan(64 * 1024)
})
it('restores row projections and selected depth through a SQL backup candidate', async () => {
  const { store, database } = sqlStore()
  const fixture = relationFixture()
  delete fixture.rows.messages[0].pendingBranchId
  delete fixture.rows.messages[0].pendingBranchSeq
  fixture.rows.messages.find((row) => row.messageId === 'old-1')!.branchId = 'original'
  const candidate = await store.beginBackupRestore('transcript')
  await candidate.append({ kind: 'header', record: fixture.record })
  for (const thread of fixture.rows.threads) await candidate.append({ kind: 'thread', thread })
  for (const message of fixture.rows.messages) await candidate.append({ kind: 'message', message })
  await candidate.publish()
  const result = await store.readThreadState({ sessionId: 'transcript', threadId: 'old', expectedRevision: 1 })
  expect(result?.status === 'ready' && result.thread.summary.messageCount).toBe(3)
  expect(
    (
      await database.query<{ depth: number }>(
        'SELECT selected_depth AS depth FROM session_messages WHERE message_id=?',
        ['old-2']
      )
    )[0].depth
  ).toBe(2)
  await candidate.dispose()
})

it.each([0, 512])('keeps body checkpoint I/O local with %i additional fork siblings', async (extraBranches) => {
  const { database, store } = sqlStore()
  const { fixture, point, selected } = forkFixture(extraBranches)
  await store.writeRows(fixture)
  const query = vi.spyOn(database, 'query')
  let revision = 1
  for (const row of [point, selected]) {
    query.mockClear()
    await store.applyDiff(
      {
        ...emptyDiff(),
        messages: {
          upsert: [
            { ...row, message: { ...row.message, contentParts: [{ type: 'text', text: 'stream checkpoint' }] } },
          ],
          delete: [],
        },
      },
      { record: fixture.record, revision: revision + 1 },
      revision
    )
    revision++
    expect(query.mock.calls.some(([sql]) => sql.includes('COUNT(*) AS count,COALESCE(SUM'))).toBe(false)
    expect(query.mock.calls.some(([sql]) => sql.includes('ORDER BY selected_depth'))).toBe(false)
    expect(query.mock.calls.some(([sql]) => sql.includes('session_message_payload_chunks'))).toBe(false)
  }
  query.mockClear()
  await store.applyDiff(
    {
      ...emptyDiff(),
      messageMetadataUpsert: [{ ...metadata(point), activeChildId: 'inactive' }],
    },
    { record: fixture.record, revision: revision + 1 },
    revision
  )
  expect(query.mock.calls.some(([sql]) => sql.includes('COUNT(*) AS count,COALESCE(SUM'))).toBe(true)
})
