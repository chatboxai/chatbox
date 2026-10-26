import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSessionRowRelationsContract,
  relationFixture,
  generatingRelationFixture,
} from '../ports/testing/session-row-relations-contract'
import { InMemorySessionRowStore } from '../testing/InMemorySessionRowStore'
import { openNodeSessionRowDatabase, type NodeSessionRowSqlDatabase } from './node-sqlite.test-support'
import { SqlSessionRowStore } from './session-row-sql'
const databases: NodeSessionRowSqlDatabase[] = []
function createStore() {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  return { database, store: new SqlSessionRowStore(database, undefined, { readByteBudget: 'none' }) }
}
afterEach(() => {
  vi.restoreAllMocks()
  while (databases.length) databases.pop()?.close()
})
for (const [name, factory] of [
  ['SQL', () => createStore().store],
  ['memory', () => new InMemorySessionRowStore()],
] as const)
  describe(`${name} row relations`, () => {
    for (const test of createSessionRowRelationsContract(factory)) it(test.name, test.run)
  })
it('locates a target via derived membership and reads no payload for row relations', async () => {
  const { database, store } = createStore()
  await store.writeRows(relationFixture())
  const query = vi.spyOn(database, 'query')
  await store.readMessageRelationsPage({
    sessionId: 'transcript',
    threadId: 'old',
    selector: { kind: 'children', parentMessageId: 'old-0', branchId: 'other' },
    limit: 1,
    expectedRevision: 1,
  })
  await store.readThreadSummariesPage({ sessionId: 'transcript', limit: 2 })
  expect(query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/payload_chunks|compaction_points/)
  query.mockClear()
  const page = await store.readTranscriptWindow({
    sessionId: 'transcript',
    origin: { messageId: 'recent-2' },
    limit: 1,
  })
  expect(page?.messages.map((row) => row.messageId)).toEqual(['recent-2'])
  const calls = query.mock.calls.map((call, index) => ({
    call,
    result: query.mock.results[index].value as Promise<Array<{ message_id: string }>>,
  }))
  expect(calls.length).toBeLessThanOrEqual(10)
  const memberships = calls.filter(({ call: [sql] }) => sql.includes('WHERE m.session_id = ? AND m.message_id = ?'))
  expect(memberships).toHaveLength(1)
  const membership = memberships[0]
  expect(membership.call[1]).toEqual(['transcript', 'recent-2'])
  const paths = calls.filter(({ call: [sql] }) => sql.includes('WITH RECURSIVE transcript_path('))
  expect(paths).toHaveLength(1)
  const path = paths[0]
  expect(path.call[0]).toContain('WITH RECURSIVE transcript_path(')
  expect(path.call[1]?.slice(2, 5)).toEqual(['transcript', 'recent', 'recent-2'])
  expect(path.call[1]?.[7]).toBe(1)
  expect((await path.result).map((row) => row.message_id)).toEqual(['recent-2'])
  for (const lookup of [membership, path]) {
    if (!lookup) throw new Error('Missing target metadata lookup')
    const [sql, params] = lookup.call
    const plan = await database.query<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)
    const searches = plan.filter((step) => /^SEARCH (m|session_messages)\b/.test(step.detail))
    expect(searches.length).toBeGreaterThan(0)
    expect(searches.every((step) => step.detail.includes('message_id=?'))).toBe(true)
    expect(plan.some((step) => /SCAN (m|session_messages)\b/.test(step.detail))).toBe(false)
  }
})

it.each(['bounded', 'none'] as const)(
  'reads a 200-message path in bounded query batches (%s)',
  async (readByteBudget) => {
    const database = openNodeSessionRowDatabase()
    databases.push(database)
    const store = new SqlSessionRowStore(database, undefined, { readByteBudget })
    const fixture = relationFixture()
    const base = fixture.rows.messages[0]
    fixture.rows.messages = Array.from({ length: 300 }, (_, index) => ({
      ...base,
      messageId: `path-${index}`,
      parentMessageId: index ? `path-${index - 1}` : null,
      activeChildId: index === 299 ? null : `path-${index + 1}`,
      pendingBranchId: undefined,
      pendingBranchOrder: undefined,
      forkCreatedAt: undefined,
      siblingOrder: 0,
      message: { id: `path-${index}`, role: 'user' as const, contentParts: [] },
    }))
    fixture.rows.threads = [
      {
        ...fixture.rows.threads.find((thread) => thread.threadId === 'old')!,
        threadOrder: -1,
        rootMessageId: 'path-0',
        activeLeafMessageId: 'path-299',
      },
    ]
    fixture.record.activeThreadId = 'old'
    await store.writeRows(fixture)
    const query = vi.spyOn(database, 'query')
    for (const direction of ['ancestors', 'selected-path'] as const) {
      query.mockClear()
      const result = await store.readMessageRelationsPage({
        sessionId: 'transcript',
        threadId: 'old',
        selector: { kind: direction, messageId: direction === 'ancestors' ? 'path-299' : 'path-0' },
        expectedRevision: 1,
        limit: 200,
      })
      expect(result?.status === 'ready' && result.rows.length).toBe(200)
      expect(result?.status === 'ready' && result.nextCursor).toBeTruthy()
      expect(query.mock.calls.length).toBeLessThanOrEqual(readByteBudget === 'none' ? 5 : 8)
      expect(query.mock.calls.map(([sql]) => sql).join('\n')).not.toContain('payload_chunks')
    }
  }
)

it.each(['bounded', 'none'] as const)(
  'reads selected bodies without enumerating thread metadata (%s)',
  async (readByteBudget) => {
    const database = openNodeSessionRowDatabase()
    databases.push(database)
    const store = new SqlSessionRowStore(database, undefined, { readByteBudget })
    const fixture = relationFixture()
    const archived = fixture.rows.threads.find((thread) => thread.threadOrder !== -1)!
    fixture.rows.threads.push(
      ...Array.from({ length: 100 }, (_, index) => ({
        ...archived,
        threadId: `empty-${index}`,
        threadOrder: index + 100,
        rootMessageId: null,
        activeLeafMessageId: null,
      }))
    )
    await store.writeRows(fixture)
    const query = vi.spyOn(database, 'query')
    const result = await store.readMessages({
      sessionId: 'transcript',
      messageIds: ['recent-2', 'old-0', 'recent-2', 'missing'],
      expectedRevision: 1,
    })
    expect(result?.messages.map((row) => row.messageId)).toEqual(['recent-2', 'old-0'])
    const threadQueries = query.mock.calls.map(([sql]) => sql).filter((sql) => sql.includes('FROM session_threads'))
    expect(threadQueries).toHaveLength(1)
    expect(threadQueries[0]).toContain('threadOrder = -1 LIMIT 2')
    expect(threadQueries[0]).not.toContain('compaction_points')
  }
)

it('slices attachment metadata during point body reads within the bridge budget', async () => {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const fixture = relationFixture()
  const row = fixture.rows.messages[0]
  row.facts!.seedAttachments = [{ name: '😀'.repeat(150000), storageKey: 'file' }]
  await new SqlSessionRowStore(database).writeRows(fixture)
  const query = database.query.bind(database)
  let maximum = 0
  const reader = new SqlSessionRowStore({
    execute: (sql) => database.execute(sql),
    executeBatch: (statements, options) => database.executeBatch(statements, options),
    query: async <T>(sql: string, params: import('./session-row-sql').SessionRowSqlBindValue[] = []): Promise<T[]> => {
      const records = await query<T>(sql, params)
      const escaped = JSON.stringify(records).replace(/[\u007f-\uffff]/g, () => '\\u0000')
      maximum = Math.max(maximum, new TextEncoder().encode(escaped).length)
      return records
    },
  })
  const result = await reader.readMessages({
    sessionId: fixture.record.id,
    messageIds: [row.messageId],
    expectedRevision: 1,
  })
  expect(result?.messages[0].facts?.seedAttachments).toEqual(row.facts!.seedAttachments)
  expect(maximum).toBeLessThan(384 * 1024)
})

it('preserves finite fractional timestamps in relationship metadata', async () => {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const store = new SqlSessionRowStore(database)
  const snapshot = relationFixture()
  const row = snapshot.rows.messages[0]
  row.createdAt = 1.25
  row.updatedAt = 2.5
  await store.writeRows(snapshot)
  const result = await store.readMessageMetadata({
    sessionId: row.sessionId,
    messageIds: [row.messageId],
    expectedRevision: 1,
  })
  expect(result?.status).toBe('ready')
  if (result?.status === 'ready') expect(result.rows[0]).toMatchObject({ createdAt: 1.25, updatedAt: 2.5 })
})

it.each(['bounded', 'none'] as const)(
  'uses the status index for one bounded thread metadata page (%s)',
  async (readByteBudget) => {
    const database = openNodeSessionRowDatabase()
    databases.push(database)
    const store = new SqlSessionRowStore(database, undefined, { readByteBudget })
    await store.writeRows(generatingRelationFixture())
    const query = vi.spyOn(database, 'query')
    const page = await store.readMessageRelationsPage({
      sessionId: 'transcript',
      threadId: 'old',
      expectedRevision: 1,
      selector: { kind: 'status', status: 'generating' },
      limit: 200,
    })
    expect(page?.status === 'ready' && page.rows.length).toBe(200)
    const calls = [...query.mock.calls]
    expect(calls.map(([sql]) => sql).join('\n')).not.toMatch(/payload_chunks|message_json|compaction_points/)
    expect(calls.length).toBeLessThanOrEqual(readByteBudget === 'none' ? 5 : 8)
    const selected = calls.find(([sql]) => sql.includes('WHERE status=? AND session_id=? AND thread_id=?'))!
    const plan = await database.query<{ detail: string }>(`EXPLAIN QUERY PLAN ${selected[0]}`, selected[1])
    expect(plan.some((step) => step.detail.includes('idx_session_messages_status'))).toBe(true)
    expect(plan.some((step) => /SCAN (m|session_messages)\b/.test(step.detail))).toBe(false)
  }
)

it('invalidates warmed links after replacement and derives the next local write from new edges', async () => {
  const { database, store } = createStore()
  const snapshot = relationFixture()
  await store.writeRows(snapshot)
  await store.prefetchThreadLinks({ sessionId: 'transcript', threadId: 'old', expectedRevision: 1 })
  snapshot.revision = 2
  snapshot.rows.messages.find((row) => row.messageId === 'old-0')!.activeChildId = 'inactive'
  snapshot.rows.threads.find((row) => row.threadId === 'old')!.activeLeafMessageId = 'inactive'
  await new SqlSessionRowStore(database, undefined, { readByteBudget: 'none' }).writeRows(snapshot, 1)
  await store.applyDiff(
    {
      sessionId: 'transcript',
      threads: { upsert: [], delete: [] },
      messages: { upsert: [], delete: [] },
      messageMetadataUpsert: [{ ...snapshot.rows.messages.find((row) => row.messageId === 'old-0')!, updatedAt: 1234 }],
    },
    { record: snapshot.record, revision: 3 },
    2
  )
  const thread = await store.readThreadState({ sessionId: 'transcript', threadId: 'old', expectedRevision: 3 })
  expect(thread?.status === 'ready' && thread.thread.activeLeafMessageId).toBe('inactive')
})

it('derives membership for path, children and status pages in one SQL question', async () => {
  const { database, store } = createStore()
  const snapshot = relationFixture()
  snapshot.rows.messages.find((row) => row.messageId === 'old-1')!.status = 'generating'
  await store.writeRows(snapshot)
  for (const selector of [
    { kind: 'selected-path' as const, messageId: 'old-0' },
    { kind: 'children' as const, parentMessageId: 'old-0' },
    { kind: 'status' as const, status: 'generating' as const },
  ]) {
    const query = vi.spyOn(database, 'query')
    const page = await store.readMessageRelationsPage({
      sessionId: 'transcript',
      threadId: 'old',
      expectedRevision: 1,
      selector,
      limit: 200,
    })
    expect(page?.status).toBe('ready')
    if (page?.status === 'ready') for (const row of page.rows) expect(row.selected).toBe(row.messageId !== 'inactive')
    expect(query.mock.calls.filter(([sql]) => sql.includes('relation_page'))).toHaveLength(1)
    query.mockRestore()
  }
})
