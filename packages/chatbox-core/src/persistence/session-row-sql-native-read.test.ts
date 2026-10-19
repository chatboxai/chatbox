import { afterEach, describe, expect, it } from 'vitest'
import { type BackupRow, DEFAULT_BACKUP_PAGE_LIMITS } from '../backup/session-port'
import { type SessionRowSnapshot, SessionRowConflictError } from '../ports/session-row-store'
import type { SessionTextTokenResult } from '../ports/session-text-tokens'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { expectedContextMessage } from './session-context-read.test-support'
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
  return {
    revision: 1,
    record: { id: sessionId, name: 'Native reads', type: 'chat', storageFormat: 'rows', activeThreadId: threadId },
    rows: {
      sessionId,
      threads: [
        {
          sessionId,
          threadId,
          seq: -1,
          name: '线程\u0000😀'.repeat(10000),
          createdAt: 1,
          rootMessageId: ids[0] ?? null,
          activeLeafMessageId: ids.at(-1) ?? null,
          compactionPoints: [],
        },
        {
          sessionId,
          threadId: 'archived',
          seq: 0,
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
        seq: index,
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
  }
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
    const first = await reader.readMessageWindow({ sessionId: snapshot.record.id, edge: 'head', limit: 2 })
    expect(first?.messages).toEqual(snapshot.rows.messages.slice(0, 2))
    expect(first?.thread).toEqual(snapshot.rows.threads[0])
    const payloads = calls.filter(({ sql }) => isPayloadQuery(sql))
    expect(payloads).toHaveLength(1)
    expect(payloads[0].binds).toBe(2)
    expect(payloads[0].bytes).toBeGreaterThan(384 * 1024)
    expect(calls.some(({ sql }) => sql.includes('response_bytes') || sql.includes('substr('))).toBe(false)
    if (!first?.newer) throw new Error('Missing forward cursor')
    expect(
      (await reader.readMessageWindow({ sessionId: snapshot.record.id, cursor: first.newer, limit: 2 }))?.messages
    ).toEqual(snapshot.rows.messages.slice(2))
  })

  it('retains bounded bridge reads by default', async () => {
    const { writer, reader, calls } = setup({})
    const snapshot = fixture(2, '正文😀'.repeat(40000))
    snapshot.rows.threads[0].name = 'Wide thread name'.repeat(1000)
    await writer.writeRows(snapshot)
    expect((await reader.readMessageWindow({ sessionId: snapshot.record.id, limit: 2 }))?.messages).toEqual(
      snapshot.rows.messages
    )
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
    expect((await reader.readStructure({ sessionId: snapshot.record.id }))?.messages).toEqual(
      snapshot.rows.messages.map(({ message: _message, ...row }) => row)
    )
    expect(calls.some(({ sql }) => sql.includes('session_message_payload_chunks'))).toBe(false)
    expect(
      (
        await reader.readThreadSuffix({
          sessionId: snapshot.record.id,
          threadId: 'active',
          afterSeq: 796,
          expectedRevision: 1,
        })
      )?.messages
    ).toEqual(snapshot.rows.messages.slice(797))
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
    const context = await reader.readContext({ sessionId: snapshot.record.id })
    expect(context?.messages).toEqual(snapshot.rows.messages.map(expectedContextMessage))
    expect(calls.some(({ sql }) => sql.includes('response_bytes'))).toBe(false)
    const sources = Object.values(context?.textTokens?.sources ?? {})
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

  it('keeps payload write chunks and archive record/block limits', async () => {
    const { reader, database } = setup()
    const snapshot = fixture(2, '正文😀'.repeat(40000))
    snapshot.rows.threads[0].name = 'Active'
    await reader.writeRows(snapshot)
    const chunks = await database.query<{ bytes: number }>(
      'SELECT length(CAST(value AS BLOB)) AS bytes FROM session_message_payload_chunks'
    )
    expect(chunks.length).toBeGreaterThan(2)
    expect(Math.max(...chunks.map(({ bytes }) => bytes))).toBeLessThanOrEqual(128 * 1024)
    const limits = { ...DEFAULT_BACKUP_PAGE_LIMITS, maxRecordBytes: 32 * 1024 }
    const rows: BackupRow[] = []
    for await (const row of reader.iterateBackupRows(snapshot.record.id, limits)) rows.push(row)
    expect(rows.every((row) => encoder.encode(JSON.stringify(row)).byteLength <= limits.maxRecordBytes)).toBe(true)
    const archived = rows.find((row) => row.kind === 'message')
    if (archived?.kind !== 'message' || !archived.payload?.chunks) throw new Error('Missing archive payload blocks')
    let blockCount = 0
    for await (const block of archived.payload.chunks()) {
      expect(block.byteLength).toBeLessThanOrEqual(128 * 1024)
      blockCount++
    }
    expect(blockCount).toBeGreaterThan(1)
  })

  it.each([
    'UPDATE session_message_payload_chunks SET value=CAST(value AS BLOB)',
    'UPDATE session_message_payload_chunks SET chunk_index=-1',
    'UPDATE session_message_payload_chunks SET chunk_index=0.5',
    'DELETE FROM session_message_payload_chunks',
    'UPDATE session_messages SET payload_chunk_count=2',
    'UPDATE session_messages SET payload_utf8_length=1',
    "UPDATE session_message_payload_chunks SET value='[' || substr(value,2)",
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
    'UPDATE session_messages SET payload_chunk_count=0',
    'UPDATE session_messages SET seq=0.5',
    "UPDATE session_threads SET compaction_points_json='{'",
  ])('rejects invalid context metadata: %s', async (sql) => {
    const { writer, reader, database } = setup()
    const snapshot = fixture(1)
    await writer.writeRows(snapshot)
    await database.executeBatch([{ sql, params: [] }])
    await expect(reader.readContext({ sessionId: snapshot.record.id })).rejects.toMatchObject({
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
    const first = await reader.readMessageWindow({ sessionId: snapshot.record.id, limit: 1 })
    if (!first?.older) throw new Error('Missing backward cursor')
    change = () =>
      database.executeBatch([
        { sql: 'UPDATE session_row_heads SET revision=2', params: [] },
        { sql: 'UPDATE session_threads SET commit_revision=2 WHERE seq=-1', params: [] },
      ])
    await expect(
      reader.readMessageWindow({ sessionId: snapshot.record.id, limit: 1, cursor: first.older })
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
