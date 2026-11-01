import { afterEach, describe, expect, it } from 'vitest'
import { projectRowFixture as projectFactsFixture, storageRowFixture } from '../ports/testing/session-row-fixtures'
import type { SessionRows } from '../ports/session-row-store'
import type { MessageRow } from '../session/session-tree/types'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { type SessionRowSqlBindValue, SqlSessionRowStore } from './session-row-sql'

const databases: NodeSessionRowSqlDatabase[] = []
const encoder = new TextEncoder()

function message(messageId: string, siblingOrder: number, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    sessionId: 'session',
    threadId: 'thread',
    messageId,
    siblingOrder,
    parentMessageId: null,
    activeChildId: null,
    branchId: null,
    kind: 'message',
    status: 'settled',
    createdAt: 1,
    updatedAt: 1,
    message: { id: messageId, role: 'user', contentParts: [] },
    ...overrides,
  }
}

function snapshot(messages: MessageRow[], revision = 1) {
  const rows: SessionRows = {
    sessionId: 'session',
    messages,
    threads: [
      {
        sessionId: 'session',
        threadId: 'thread',
        threadOrder: -1,
        name: null,
        createdAt: 1,
        rootMessageId: null,
        activeLeafMessageId: null,
        compactionPoints: [],
      },
    ],
  }
  return {
    rows,
    revision,
    record: {
      id: 'session',
      name: 'session',
      type: 'chat' as const,
      storageFormat: 'rows' as const,
      activeThreadId: 'thread',
    },
  }
}

function setup(onQuery?: (sql: string, params: SessionRowSqlBindValue[]) => void | Promise<void>) {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const statistics = { metadataQueries: 0, maxRequestBytes: 0, maxResponseBytes: 0, maxBinds: 0 }
  const reader = new SqlSessionRowStore({
    execute: (sql) => database.execute(sql),
    executeBatch: (statements, options) => database.executeBatch(statements, options),
    query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
      const result = await database.query<T>(sql, params)
      const requestBytes = encoder.encode(
        JSON.stringify({ database: 'chatbox', statement: sql, values: params, readonly: false })
      ).byteLength
      const escapedResponse = JSON.stringify({ values: result }).replace(
        /[\u007f-\uffff]/g,
        (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
      )
      const responseBytes = encoder.encode(escapedResponse).byteLength
      statistics.maxRequestBytes = Math.max(statistics.maxRequestBytes, requestBytes)
      statistics.maxResponseBytes = Math.max(statistics.maxResponseBytes, responseBytes)
      statistics.maxBinds = Math.max(statistics.maxBinds, params.length)
      if (sql.includes('message_id IN (') || sql.startsWith('WITH requested(requested_id')) {
        statistics.metadataQueries++
        if (statistics.metadataQueries === 1) {
          const plan = await database.query<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)
          expect(plan.some((step) => /SEARCH (m|session_messages) USING INDEX/.test(step.detail))).toBe(true)
          expect(plan.some((step) => /SCAN (m|session_messages)\b/.test(step.detail))).toBe(false)
        }
        expect(requestBytes).toBeLessThan(384 * 1024)
        expect(responseBytes).toBeLessThan(384 * 1024)
      }
      expect(requestBytes).toBeLessThan(512 * 1024)
      expect(responseBytes).toBeLessThan(512 * 1024)
      await onQuery?.(sql, params)
      return result
    },
  })
  return { database, writer: new SqlSessionRowStore(database), reader, statistics }
}

afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

describe('SqlSessionRowStore bounded by-ID metadata reads', () => {
  it.each([1_000, 10_000, 100_000])(
    'batches %i valid targets on real SQLite',
    async (count) => {
      const { writer, reader, statistics } = setup()
      const messages = Array.from({ length: count }, (_, index) => message(`m${index}`, index))
      await writer.writeRows(snapshot(messages))
      const selected = await reader.readMessages({
        sessionId: 'session',
        messageIds: messages.map((row) => row.messageId),
      })
      expect(selected?.messages).toEqual(messages)
      expect(statistics.metadataQueries).toBeLessThanOrEqual(Math.ceil(count / 200))
      expect(statistics.maxBinds).toBeLessThanOrEqual(900)
    },
    60_000
  )

  it.each(['\u0001', '界'])('bounds wide escaped requests and metadata (%s)', async (character) => {
    const { writer, reader, statistics } = setup()
    const suffix = character.repeat(character === '界' ? 333 : 1000)
    const sessionId = `s:${suffix}`
    const threadId = `t:${suffix}`
    const messages = Array.from({ length: 240 }, (_, index) =>
      message(`${index}:${suffix}`, index, {
        sessionId,
        threadId,
        parentMessageId: suffix,
        activeChildId: suffix,
        branchId: suffix,
      })
    )
    const wideSnapshot = snapshot(messages)
    wideSnapshot.rows.sessionId = sessionId
    wideSnapshot.rows.threads[0].sessionId = sessionId
    wideSnapshot.rows.threads[0].threadId = threadId
    wideSnapshot.record.id = sessionId
    wideSnapshot.record.activeThreadId = threadId
    await writer.writeRows(wideSnapshot)
    const missing = Array.from({ length: 160 }, (_, index) => `missing${index}:${'\u0001'.repeat(8192)}`)
    const selected = await reader.readMessages({
      sessionId,
      messageIds: [...missing, ...messages.map((row) => row.messageId)],
    })
    expect(selected?.messages).toEqual(messages)
    expect(statistics.maxBinds).toBeLessThanOrEqual(900)
  })

  it('preserves unique input order across missing/deleted IDs and never hydrates unselected bodies', async () => {
    const bodyReads = new Set<string>()
    const { database, writer, reader } = setup((sql, params) => {
      if (sql.startsWith('WITH requested(payload_id, request_index)')) {
        for (const id of params) bodyReads.add(String(id))
      }
    })
    const messages = Array.from({ length: 1200 }, (_, index) => message(`m${index}`, index))
    const initial = projectRowFixture(snapshot(messages))
    await writer.writeRows(initial)
    await writer.applyDiff(
      { sessionId: 'session', threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: ['m50'] } },
      { ...initial, revision: 2 },
      1
    )
    const wanted = messages.filter((_, index) => index % 2 === 0 && index !== 50).reverse()
    const ids = ['absent', ...wanted.map((row) => row.messageId), 'm50', 'absent', wanted[0].messageId]
    const selected = await reader.readMessages({ sessionId: 'session', messageIds: ids, expectedRevision: 2 })
    expect(selected?.messages).toEqual(wanted)
    const payloads = await database.query<{ message_id: string; payload_id: string }>(
      'SELECT message_id, payload_id FROM session_messages'
    )
    expect(
      payloads
        .filter((row) => bodyReads.has(row.payload_id))
        .map((row) => row.message_id)
        .sort()
    ).toEqual(wanted.map((row) => row.messageId).sort())
    expect((await reader.readMessages({ sessionId: 'session', messageIds: [] }))?.messages).toEqual([])
    expect((await reader.readMessages({ sessionId: 'session', messageIds: ['absent', 'm50'] }))?.messages).toEqual([])
  })

  it.each([false, true])('handles a revision change between metadata pages (pinned: %s)', async (pinned) => {
    let mutated = false
    const messages = Array.from({ length: 1000 }, (_, index) => message(`m${index}`, index))
    const { writer, reader } = setup(async (sql) => {
      if (!mutated && (sql.includes('message_id IN (') || sql.includes('WITH requested'))) {
        mutated = true
        await writer.writeRows(snapshot(messages.slice(1), 2), 1)
      }
    })
    await writer.writeRows(snapshot(messages))
    const read = reader.readMessages({
      sessionId: 'session',
      messageIds: messages.map((row) => row.messageId),
      expectedRevision: pinned ? 1 : undefined,
    })
    if (pinned) await expect(read).rejects.toMatchObject({ name: 'SessionRowConflictError', actualRevision: 2 })
    else await expect(read).resolves.toMatchObject({ revision: 2, messages: messages.slice(1) })
  })

  it('rejects one oversized request ID before sending that query', async () => {
    const { writer, reader, statistics } = setup()
    await writer.writeRows(snapshot([message('m1', 0)]))
    await expect(
      reader.readMessages({ sessionId: 'session', messageIds: ['\u0001'.repeat(100_000)] })
    ).rejects.toMatchObject({
      name: 'SessionRowStoreError',
      cause: { message: 'Message selection ID exceeds the native request budget' },
    })
    expect(statistics.metadataQueries).toBe(0)
  })

  it('reports corrupt oversized metadata using a bounded response', async () => {
    const { database, writer, reader } = setup()
    await writer.writeRows(snapshot([message('m1', 0)]))
    await database.executeBatch([
      { sql: 'UPDATE session_messages SET branch_id = ? WHERE message_id = ?', params: ['x'.repeat(512 * 1024), 'm1'] },
    ])
    await expect(reader.readMessages({ sessionId: 'session', messageIds: ['m1'] })).rejects.toMatchObject({
      name: 'SessionRowStoreError',
      cause: { message: 'Message structural metadata exceeds the native response budget' },
    })
  })

  it('does not return partial results after a later metadata query fails at the same revision', async () => {
    let calls = 0
    const failure = new Error('native metadata query failed')
    const { writer, reader } = setup((sql) => {
      if ((sql.includes('message_id IN (') || sql.includes('WITH requested')) && ++calls === 2) throw failure
    })
    const messages = Array.from({ length: 1000 }, (_, index) => message(`m${index}`, index))
    await writer.writeRows(snapshot(messages))
    await expect(
      reader.readMessages({ sessionId: 'session', messageIds: messages.map((row) => row.messageId) })
    ).rejects.toMatchObject({ name: 'SessionRowStoreError', cause: failure })
  })

  it.each([false, true])('handles deletion between metadata pages (pinned: %s)', async (pinned) => {
    let deleted = false
    const { writer, reader } = setup(async (sql) => {
      if (!deleted && (sql.includes('message_id IN (') || sql.includes('WITH requested'))) {
        deleted = true
        await writer.deleteRows('session', 1)
      }
    })
    const messages = Array.from({ length: 1000 }, (_, index) => message(`m${index}`, index))
    await writer.writeRows(snapshot(messages))
    const read = reader.readMessages({
      sessionId: 'session',
      messageIds: messages.map((row) => row.messageId),
      expectedRevision: pinned ? 1 : undefined,
    })
    if (pinned) await expect(read).rejects.toMatchObject({ name: 'SessionRowConflictError', actualRevision: 2 })
    else await expect(read).resolves.toBeNull()
  })
})

function projectRowFixture(...args: Parameters<typeof projectFactsFixture>) {
  return storageRowFixture(projectFactsFixture(...args))
}
