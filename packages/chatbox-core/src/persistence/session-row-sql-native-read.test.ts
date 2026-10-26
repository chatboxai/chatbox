import { afterEach, describe, expect, it } from 'vitest'
import { readRowContextSource } from '../application/session/row-context'
import { SessionRowConflictError, type SessionRowSnapshot } from '../ports/session-row-store'
import type { SessionStoredRow } from '../ports/session-row-transfer'
import type { SessionTextTokenResult } from '../ports/session-text-tokens'
import { projectRowFixture as projectFactsFixture, storageRowFixture } from '../ports/testing/session-row-fixtures'
import { iterateRowResourceReferences } from '../resources/row-resources'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { type SessionRowSqlBindValue, type SessionRowSqlReadOptions, SqlSessionRowStore } from './session-row-sql'

const databases: NodeSessionRowSqlDatabase[] = []
const encoder = new TextEncoder()
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture(count = 3, text = '正文😀', wideIds = false): SessionRowSnapshot {
  const sessionId = 'native-session'
  const threadId = 'active'
  const ids = Array.from({ length: count }, (_, index) => `m-${index}${wideIds ? '界'.repeat(240) : ''}`)
  return projectRowFixture({
    revision: 1,
    record: { id: sessionId, name: 'Native reads', type: 'chat', storageFormat: 'rows', activeThreadId: threadId },
    rows: {
      sessionId,
      threads: [
        {
          sessionId,
          threadId,
          threadOrder: -1,
          name: '线程\u0000😀'.repeat(10000),
          createdAt: 1,
          rootMessageId: ids[0] ?? null,
          activeLeafMessageId: ids.at(-1) ?? null,
          compactionPoints: [],
        },
        {
          sessionId,
          threadId: 'archived',
          threadOrder: 0,
          name: 'History',
          createdAt: 1,
          rootMessageId: null,
          activeLeafMessageId: null,
          compactionPoints: [],
        },
      ],
      messages: ids.map((messageId, index) => ({
        sessionId,
        threadId,
        messageId,
        siblingOrder: index,
        parentMessageId: ids[index - 1] ?? null,
        activeChildId: ids[index + 1] ?? null,
        kind: 'message',
        status: 'settled',
        createdAt: 1,
        updatedAt: 1,
        branchId: null,
        message: { id: messageId, role: index % 2 ? 'assistant' : 'user', contentParts: [{ type: 'text', text }] },
      })),
    },
  })
}

function setup(
  options: SessionRowSqlReadOptions = { readByteBudget: 'none' },
  onQuery?: (sql: string) => Promise<void>
) {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const calls: Array<{ sql: string; binds: number; bytes: number; rows: number }> = []
  const writeBytes: number[] = []
  const reader = new SqlSessionRowStore(
    {
      execute: (sql) => database.execute(sql),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const rows = await database.query<T>(sql, params)
        calls.push({
          sql,
          binds: params.length,
          bytes: encoder.encode(JSON.stringify(rows)).byteLength,
          rows: rows.length,
        })
        expect(params.length).toBeLessThanOrEqual(900)
        await onQuery?.(sql)
        return rows
      },
      executeBatch: (statements, batchOptions) => {
        const batch = [...statements]
        writeBytes.push(
          encoder.encode(JSON.stringify(batch.map(({ sql, params }) => ({ statement: sql, values: params }))))
            .byteLength
        )
        return database.executeBatch(batch, batchOptions)
      },
    },
    undefined,
    options
  )
  return { database, reader, writer: new SqlSessionRowStore(database), calls, writeBytes }
}

const isPayloadQuery = (sql: string) => sql.startsWith('WITH requested(payload_id, request_index)')

describe('structured native SQL read policy', () => {
  it('reads only selected window bodies in one native batch and preserves wide NUL metadata', async () => {
    const { writer, reader, calls } = setup()
    const snapshot = fixture(4, '正文😀'.repeat(40000))
    await writer.writeRows(snapshot)
    const first = await reader.readTranscriptWindow({ sessionId: snapshot.record.id, origin: 'head', limit: 2 })
    expect(first?.messages).toEqual(snapshot.rows.messages.slice(0, 2))
    expect(first?.threads.find((thread) => thread.threadId === snapshot.rows.threads[0].threadId)).toMatchObject({
      name: snapshot.rows.threads[0].name,
    })
    const payloads = calls.filter(({ sql }) => isPayloadQuery(sql))
    expect(payloads).toHaveLength(1)
    expect(payloads[0].binds).toBe(2)
    expect(payloads[0].bytes).toBeGreaterThan(384 * 1024)
    expect(calls.some(({ sql }) => sql.includes('response_bytes') || sql.includes('substr('))).toBe(false)
    if (!first?.newer) throw new Error('Missing forward cursor')
    expect(
      (await reader.readTranscriptWindow({ sessionId: snapshot.record.id, cursor: first.newer, limit: 2 }))?.messages
    ).toEqual(snapshot.rows.messages.slice(2))
  })

  it('retains bounded bridge reads by default', async () => {
    const { writer, reader, calls } = setup({})
    const snapshot = fixture(2, '正文😀'.repeat(40000))
    snapshot.rows.threads[0].name = 'Wide\u0000thread😀'.repeat(1000)
    await writer.writeRows(snapshot)
    expect((await reader.readTranscriptWindow({ sessionId: snapshot.record.id, limit: 2 }))?.messages).toEqual(
      snapshot.rows.messages
    )
    expect(
      (await reader.readTranscriptWindow({ sessionId: snapshot.record.id, limit: 2 }))?.threads.find(
        (thread) => thread.threadId === 'active'
      )?.name
    ).toBe(snapshot.rows.threads[0].name)
    expect(calls.some(({ sql }) => sql.includes('response_bytes'))).toBe(true)
    expect(calls.some(({ sql }) => sql.includes('substr('))).toBe(true)
    expect(Math.max(...calls.map(({ bytes }) => bytes))).toBeLessThan(384 * 1024)
  })

  it('preserves row and bind batches, caller order, and metadata-only reads', async () => {
    const { writer, reader, calls } = setup()
    const snapshot = fixture(800, 'text', true)
    await writer.writeRows(snapshot)
    const reversed = [...snapshot.rows.messages].reverse()
    const selection = await reader.readMessages({
      sessionId: snapshot.record.id,
      messageIds: ['missing', ...reversed.map(({ messageId }) => messageId), reversed[0].messageId],
    })
    expect(selection?.messages).toEqual(reversed)
    const payloads = calls.filter(({ sql }) => isPayloadQuery(sql))
    expect(payloads.map(({ binds }) => binds)).toEqual([768, 32])
    expect(
      calls.filter(({ sql }) => sql.startsWith('WITH requested(requested_id')).every(({ rows }) => rows <= 768)
    ).toBe(true)
    calls.length = 0
    const metadata = await reader.readMessageMetadata({
      sessionId: snapshot.record.id,
      messageIds: reversed.slice(0, 200).map((row) => row.messageId),
      expectedRevision: 1,
    })
    expect(metadata?.status === 'ready' && metadata.rows.map((row) => row.messageId)).toEqual(
      reversed.slice(0, 200).map((row) => row.messageId)
    )
    expect(calls.some(({ sql }) => sql.includes('session_message_payload_chunks'))).toBe(false)
    const suffix = await reader.readBranchMessagesPage({
      sessionId: snapshot.record.id,
      firstMessageId: snapshot.rows.messages[797].messageId,
      limit: 3,
      expectedRevision: 1,
    })
    expect(suffix?.messages).toEqual(snapshot.rows.messages.slice(797))
    const first = await reader.readThreadsPage({ sessionId: snapshot.record.id, limit: 1 })
    expect(first?.threadIds).toEqual(['active'])
    if (!first?.nextCursor) throw new Error('Missing thread cursor')
    expect(
      (await reader.readThreadsPage({ sessionId: snapshot.record.id, limit: 1, cursor: first.nextCursor }))?.threadIds
    ).toEqual(['archived'])
  })

  it('reads native context consistently and keeps token writes bounded', async () => {
    const { writer, reader, calls, writeBytes } = setup()
    const snapshot = fixture(300, 'text', true)
    await writer.writeRows(snapshot)
    const context = await readRowContextSource(reader, { sessionId: snapshot.record.id })
    expect(context?.candidateMessages).toEqual(snapshot.rows.messages.map((row) => row.message))
    expect(calls.some(({ sql }) => sql.includes('response_bytes'))).toBe(false)
    const selected = await reader.readMessages({
      sessionId: snapshot.record.id,
      messageIds: snapshot.rows.messages.map((row) => row.messageId),
    })
    const sources = Object.values(selected?.textTokens?.sources ?? {})
    expect(sources).toHaveLength(300)
    const results: SessionTextTokenResult[] = sources.map((source) => ({
      source,
      value: { tokenizerType: 'default', sourceDigest: source.textDigest, tokens: 7, calculatedAt: 1 },
    }))
    expect(await reader.acceptTextTokenResults(results)).toHaveLength(300)
    expect(Math.max(...writeBytes)).toBeLessThan(384 * 1024)
    calls.length = 0
    expect(await reader.readTextTokenResults(sources)).toHaveLength(300)
    expect(
      calls.filter(({ sql }) => sql.startsWith('WITH requested(request_index,session_id')).map(({ binds }) => binds)
    ).toEqual([865, 37])
  })

  it.each(['bounded', 'none'] as const)('iterates complete thread metadata with %s reads', async (readByteBudget) => {
    const { writer, reader, calls } = setup({ readByteBudget })
    const snapshot = fixture(3, '正文😀', true)
    snapshot.record.name = '会话😀'.repeat(200)
    snapshot.rows.messages[0].message.contentParts.push({ type: 'image', storageKey: 'picture:attachment' })
    const thread = snapshot.rows.threads[0]
    thread.name = '历史线程😀'.repeat(200)
    thread.compactionPoints = [
      {
        summaryMessageId: snapshot.rows.messages[2].messageId,
        boundaryMessageId: snapshot.rows.messages[0].messageId,
        createdAt: 1,
      },
    ]
    snapshot.rows.messages[2].kind = 'summary'
    thread.sessionPromptContextSnapshot = {
      version: 1,
      soul: '记忆😀'.repeat(200),
      memories: [],
      workspaceInstructions: 'instructions',
      workspaceDirectories: [],
      capturedAt: 1,
    }
    await writer.writeRows(snapshot)
    const rows: SessionStoredRow[] = []
    for await (const row of reader.iterateRows({ sessionId: snapshot.record.id })) rows.push(row)
    expect(rows.filter((row) => row.kind === 'thread').map((row) => row.thread)).toEqual(snapshot.rows.threads)
    expect(rows.filter((row) => row.kind === 'message').map((row) => row.message)).toEqual(snapshot.rows.messages)
    for (const column of [
      'name',
      'compaction_points_json',
      'session_prompt_context_snapshot_json',
      'session_record_json',
    ])
      expect(calls.some(({ sql }) => sql.includes(`substr(${column}`))).toBe(readByteBudget === 'bounded')
    const resourceKeys: string[] = []
    for await (const reference of iterateRowResourceReferences(reader, snapshot.record.id))
      resourceKeys.push(reference.storageKey)
    expect(resourceKeys).toEqual(['picture:attachment'])
  })

  it('stores and iterates complete large messages', async () => {
    const { reader, database } = setup()
    const snapshot = fixture(2, '正文😀'.repeat(40000))
    snapshot.rows.threads[0].name = 'Active'
    await reader.writeRows(snapshot)
    const bodies = await database.query<{ bytes: number }>(
      'SELECT length(CAST(message_json AS BLOB)) AS bytes FROM session_messages'
    )
    expect(bodies).toHaveLength(2)
    expect(bodies.every(({ bytes }) => bytes > 128 * 1024)).toBe(true)
    const rows: SessionStoredRow[] = []
    for await (const row of reader.iterateRows({ sessionId: snapshot.record.id })) rows.push(row)
    expect(rows.filter((row) => row.kind === 'message').map((row) => row.message)).toEqual(snapshot.rows.messages)
  })

  it.each([
    'UPDATE session_messages SET message_json=CAST(message_json AS BLOB)',
    'UPDATE session_messages SET payload_utf8_length=1',
    "UPDATE session_messages SET message_json='[' || substr(message_json,2)",
  ])('rejects corrupt data under native policy: %s', async (sql) => {
    const { writer, reader, database } = setup()
    const snapshot = fixture(1)
    await writer.writeRows(snapshot)
    await database.executeBatch([{ sql, params: [] }])
    await expect(reader.readMessages({ sessionId: snapshot.record.id, messageIds: ['m-0'] })).rejects.toMatchObject({
      name: 'SessionRowStoreError',
    })
  })

  it.each([
    "UPDATE session_messages SET parent_message_id=CAST('bad' AS BLOB)",
    'UPDATE session_messages SET payload_utf8_length=-1',
    'UPDATE session_messages SET siblingOrder=0.5',
    "UPDATE session_threads SET compaction_points_json='{'",
  ])('rejects invalid context metadata: %s', async (sql) => {
    const { writer, reader, database } = setup()
    const snapshot = fixture(1)
    await writer.writeRows(snapshot)
    await database.executeBatch([{ sql, params: [] }])
    await expect(readRowContextSource(reader, { sessionId: snapshot.record.id })).rejects.toMatchObject({
      name: 'SessionRowStoreError',
    })
  })

  it('rejects a cursor whose revision changes while reading native payloads', async () => {
    let change: (() => Promise<void>) | undefined
    const { writer, reader, database } = setup({ readByteBudget: 'none' }, async (sql) => {
      if (!isPayloadQuery(sql) || !change) return
      const run = change
      change = undefined
      await run()
    })
    const snapshot = fixture(3)
    await writer.writeRows(snapshot)
    const first = await reader.readTranscriptWindow({ sessionId: snapshot.record.id, limit: 1 })
    if (!first?.older) throw new Error('Missing backward cursor')
    change = () =>
      database.executeBatch([
        { sql: 'UPDATE session_row_heads SET revision=2', params: [] },
        { sql: 'UPDATE session_threads SET commit_revision=2 WHERE threadOrder=-1', params: [] },
      ])
    await expect(
      reader.readTranscriptWindow({ sessionId: snapshot.record.id, limit: 1, cursor: first.older })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
    expect((await reader.readSnapshot(snapshot.record.id))?.revision).toBe(2)
    await expect(
      reader.applyDiff(
        { sessionId: snapshot.record.id, messages: { upsert: [], delete: [] }, threads: { upsert: [], delete: [] } },
        { record: snapshot.record, revision: 3 },
        1
      )
    ).rejects.toBeInstanceOf(SessionRowConflictError)
  })
})

function projectRowFixture(...args: Parameters<typeof projectFactsFixture>) {
  return storageRowFixture(projectFactsFixture(...args))
}
