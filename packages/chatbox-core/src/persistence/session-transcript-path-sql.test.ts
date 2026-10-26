import { afterEach, describe, expect, it, vi } from 'vitest'
import { RowBackedSessionRepository } from '../application/session/RowBackedSessionRepository'
import { SessionRowWriteQueue } from '../application/session/SessionRowWriteQueue'
import { SessionSearchService } from '../application/session/SessionSearchService'
import { SessionRowConflictError, type SessionRowSnapshot } from '../ports/session-row-store'
import { projectRowFixture } from '../ports/testing/session-row-fixtures'
import { transcriptFixture } from '../ports/testing/session-transcript-contract'
import { InMemorySessionRecordStore } from '../testing/InMemorySessionRecordStore'
import { openNodeSessionRowDatabase, type NodeSessionRowSqlDatabase } from './node-sqlite.test-support'
import { SqlSessionRowStore, type SessionRowSqlBindValue } from './session-row-sql'

const databases: NodeSessionRowSqlDatabase[] = []
const pathQuery = (sql: string) => sql.includes('WITH RECURSIVE transcript_path(')
const bodyQuery = (sql: string) => sql.startsWith('WITH requested(payload_id, request_index)')
const ids = (count: number, start = 0) => Array.from({ length: count }, (_, index) => `m${start + index}`)

function chain(count = 5): SessionRowSnapshot {
  const fixture = transcriptFixture()
  const template = fixture.rows.messages.find((row) => row.messageId === 'active-0')!
  fixture.rows.threads = [
    {
      ...fixture.rows.threads.find((thread) => thread.threadId === 'active')!,
      rootMessageId: 'm0',
      activeLeafMessageId: `m${count - 1}`,
    },
  ]
  fixture.rows.messages = ids(count).map((messageId, index) => ({
    ...template,
    messageId,
    siblingOrder: index * 3,
    parentMessageId: index ? `m${index - 1}` : null,
    activeChildId: index < count - 1 ? `m${index + 1}` : null,
    message: {
      id: messageId,
      role: 'user' as const,
      contentParts: [{ type: 'text', text: index === 180 ? 'selected needle' : 'ordinary' }],
    },
  }))
  return projectRowFixture(fixture)
}

async function harness(bounded: boolean, fixture = chain()) {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const store = new SqlSessionRowStore(database, undefined, bounded ? {} : { readByteBudget: 'none' })
  await store.writeRows(fixture)
  const query = vi.spyOn(database, 'query')
  return { database, store, query, fixture }
}

afterEach(() => {
  vi.restoreAllMocks()
  while (databases.length) databases.pop()!.close()
})

describe.each([true, false])('SQL transcript metadata batches (bounded bridge: %s)', (bounded) => {
  it('finds a seventh-page Search hit with constant per-page native roundtrips and bounded indexed paths', async () => {
    const { database, store, query, fixture } = await harness(bounded, chain(500))
    const records = new InMemorySessionRecordStore()
    await records.setRecord(fixture.record)
    const repository = new RowBackedSessionRepository({
      records,
      rows: store,
      writes: new SessionRowWriteQueue((_id, run) => run()),
    })
    const costs: number[] = []
    const search = new SessionSearchService(
      {
        listSessionsMetaPage: async () => ({ items: [], nextCursor: null, total: 0 }),
        readSessionSearchCandidates: (request) => repository.readSessionSearchCandidates(request),
        readSessionSearchWindow: async (request) => {
          const before = query.mock.calls.length
          const page = await repository.readSessionSearchWindow(request)
          if (!request.messageId) {
            costs.push(query.mock.calls.length - before)
            expect(page?.page?.messages.map((row) => row.messageId)).toEqual(ids(50, 500 - costs.length * 50))
          }
          return page
        },
      },
      async () => {}
    )
    const result = await search.search('needle', { sessionId: 'transcript', limit: 1 })
    expect(result.failedSessionIds).toEqual([])
    expect(result.hits.map((hit) => hit.messageId)).toEqual(['m180'])
    expect(costs).toHaveLength(7)
    expect(costs.every((count) => count <= 26)).toBe(true)
    const paths = query.mock.calls
      .map((call, index) => ({ call, result: query.mock.results[index].value as Promise<unknown[]> }))
      .filter(({ call: [sql] }) => pathQuery(sql))
    expect(paths).toHaveLength(8) // Seven windows and the final one-message candidate check.
    for (const {
      call: [sql, params],
      result: pathResult,
    } of paths) {
      expect((await pathResult).length).toBeLessThanOrEqual(51)
      const plan = await database.query<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)
      const lookups = plan.filter((step) => step.detail.startsWith('SEARCH m '))
      expect(lookups.length).toBeGreaterThan(0)
      expect(lookups.every((step) => step.detail.includes('message_id=?'))).toBe(true)
    }
  })

  it.each(['head', 'tail'] as const)('stops metadata before damage beyond the %s byte lookahead', async (origin) => {
    const { database, store, query } = await harness(bounded)
    const edge = origin === 'head' ? 'm0' : 'm4'
    const [length] = await database.query<{ size: number }>(
      'SELECT payload_utf8_length AS size FROM session_messages WHERE message_id=?',
      [edge]
    )
    await database.execute("UPDATE session_messages SET siblingOrder=-1 WHERE message_id='m2'")
    query.mockClear()
    const page = await store.readTranscriptWindow({ sessionId: 'transcript', origin, limit: 5, maxBytes: length.size })
    expect(page?.messages.map((row) => row.messageId)).toEqual([edge])
    expect(query.mock.calls.filter(([sql]) => pathQuery(sql))).toHaveLength(1)
    const pathResult = query.mock.results.find((_, index) => pathQuery(query.mock.calls[index][0]))!
    expect(((await pathResult.value) as Array<{ message_id: string }>).map((row) => row.message_id)).toEqual(
      origin === 'head' ? ['m0', 'm1'] : ['m4', 'm3']
    )
    expect(query.mock.calls.filter(([sql]) => bodyQuery(sql)).every(([, params]) => params?.length === 1)).toBe(true)
  })

  it('keeps a spent byte budget across a thread boundary and a cursor skip', async () => {
    const { database, store, query } = await harness(bounded, transcriptFixture())
    const [total] = await database.query<{ size: number }>(
      "SELECT SUM(payload_utf8_length) AS size FROM session_messages WHERE thread_id='old' AND message_id IN ('old-0','old-1','old-2')"
    )
    await database.execute("UPDATE session_messages SET siblingOrder=-1 WHERE message_id='recent-1'")
    query.mockClear()
    const head = await store.readTranscriptWindow({
      sessionId: 'transcript',
      origin: 'head',
      limit: 5,
      maxBytes: total.size,
    })
    expect(head?.messages.map((row) => row.messageId)).toEqual(['old-0', 'old-1', 'old-2'])
    const next = await store.readTranscriptWindow({
      sessionId: 'transcript',
      origin: { messageId: 'active-0' },
      limit: 1,
    })
    const back = await store.readTranscriptWindow({ sessionId: 'transcript', cursor: next!.newer!, limit: 1 })
    expect(back?.messages.map((row) => row.messageId)).toEqual(['active-1'])
  })

  it('returns a >2 MiB first body alone and never hydrates its lookahead', async () => {
    const fixture = chain()
    fixture.rows.messages[0].message.contentParts = [{ type: 'text', text: '界'.repeat(750_000) }]
    const { store, query } = await harness(bounded, projectRowFixture(fixture))
    const page = await store.readTranscriptWindow({ sessionId: 'transcript', origin: 'head', limit: 50 })
    expect(page?.messages.map((row) => row.messageId)).toEqual(['m0'])
    expect(page!.payloadBytes).toBeGreaterThan(2 * 1024 * 1024)
    const selected = query.mock.calls.filter(([sql]) => sql.startsWith('WITH requested(requested_id, request_index)'))
    expect(selected).toHaveLength(1)
    expect(selected[0][1]).toContain('m0')
    expect(selected[0][1]).not.toContain('m1')
  })

  it.each([
    ["active_child_id='missing'", 'm1'],
    ["active_child_id='m1'", 'm2'],
    ["parent_message_id='m0'", 'm2'],
    ["thread_id='other'", 'm2'],
    ['payload_utf8_length=-1', 'm1'],
    ['payload_utf8_length=1.5', 'm1'],
  ])('rejects path corruption (%s) before returning bodies', async (mutation, messageId) => {
    const { database, store, query } = await harness(bounded)
    await database.executeBatch([
      { sql: `UPDATE session_messages SET ${mutation} WHERE message_id=?`, params: [messageId] },
    ])
    query.mockClear()
    await expect(store.readTranscriptWindow({ sessionId: 'transcript', origin: 'head', limit: 50 })).rejects.toThrow()
    expect(query.mock.calls.some(([sql]) => bodyQuery(sql))).toBe(false)
  })

  it('slices long Unicode metadata within the bridge response budget', async () => {
    const { database, store, query } = await harness(bounded, chain(12))
    const identity = '分支/"'.repeat(1500)
    await database.executeBatch(
      ids(12).map((id) => ({
        sql: "UPDATE session_messages SET row_metadata_json=json_set(row_metadata_json,'$.pendingBranchId',?) WHERE message_id=?",
        params: [identity, id],
      }))
    )
    query.mockRestore()
    const original = database.query.bind(database)
    let maximumResponse = 0
    vi.spyOn(database, 'query').mockImplementation(
      async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const result = await original<T>(sql, params)
        if (pathQuery(sql)) {
          const escaped = JSON.stringify(result).replace(/[\u007f-\uffff]/g, () => '\\u0000')
          maximumResponse = Math.max(maximumResponse, new TextEncoder().encode(escaped).length)
        }
        return result
      }
    )
    const page = await store.readTranscriptWindow({ sessionId: 'transcript', origin: 'head', limit: 12 })
    expect(page?.messages.map((row) => row.messageId)).toEqual(ids(12))
    expect(page?.messages.every((row) => row.pendingBranchId === identity)).toBe(true)
    expect(maximumResponse).toBeGreaterThan(0)
    if (bounded) expect(maximumResponse).toBeLessThan(196608)
  })

  it.each(['path', 'body'] as const)('fences a changed commit during the %s batch', async (phase) => {
    const { database, store, query } = await harness(bounded)
    query.mockRestore()
    const original = database.query.bind(database)
    let changed = false
    vi.spyOn(database, 'query').mockImplementation(
      async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const result = await original<T>(sql, params)
        if (!changed && (phase === 'path' ? pathQuery(sql) : bodyQuery(sql))) {
          changed = true
          await database.execute(
            "UPDATE session_row_heads SET revision=2 WHERE session_id='transcript'; UPDATE session_threads SET commit_revision=2 WHERE session_id='transcript' AND siblingOrder=-1"
          )
        }
        return result
      }
    )
    await expect(
      store.readTranscriptWindow({ sessionId: 'transcript', origin: 'head', limit: 50, expectedRevision: 1 })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
    expect(changed).toBe(true)
  })
})
