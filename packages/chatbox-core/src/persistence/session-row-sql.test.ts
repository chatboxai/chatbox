import { afterEach, describe, expect, it, vi } from 'vitest'
import { readRowContextSource } from '../application/session/row-context'
import {
  type SessionRowCommit,
  SessionRowConflictError,
  type SessionRowSnapshot,
  type SessionRows,
  type SessionRowsDiff,
} from '../ports/session-row-store'
import { projectRowFixture } from '../ports/testing/session-row-fixtures'
import { createSessionRowStoreContract } from '../ports/testing/session-row-store-contract'
import type { MessageRow, SessionRecordV2, ThreadRow } from '../session/session-tree/types'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { contextSession, contextSnapshot } from './session-context-read.test-support'
import {
  type SessionRowSqlBindValue,
  type SessionRowSqlDatabase,
  type SessionRowSqlStatement,
  SqlSessionRowStore,
} from './session-row-sql'

const openDatabases: NodeSessionRowSqlDatabase[] = []

function createStore(): { database: NodeSessionRowSqlDatabase; store: SqlSessionRowStore } {
  const database = openNodeSessionRowDatabase()
  openDatabases.push(database)
  return { database, store: new SqlSessionRowStore(database) }
}

function threadRow(threadId: string, overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    sessionId: 'session-1',
    threadId,
    seq: -1,
    name: threadId,
    createdAt: 1_000,
    rootMessageId: null,
    activeLeafMessageId: null,
    compactionPoints: [],
    ...overrides,
  }
}

function messageRow(threadId: string, messageId: string, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    sessionId: 'session-1',
    threadId,
    messageId,
    parentMessageId: null,
    activeChildId: null,
    seq: 0,
    kind: 'message',
    status: 'settled',
    createdAt: 1_000,
    updatedAt: 1_000,
    branchId: null,
    message: { id: messageId, role: 'user', contentParts: [] },
    ...overrides,
  }
}

function commit(revision: number, record?: SessionRecordV2): SessionRowCommit {
  return {
    revision,
    record: record ?? {
      id: 'session-1',
      type: 'chat',
      name: 'session-1',
      activeThreadId: 'thread-active',
      storageFormat: 'rows',
      rowFormatVersion: 3,
      rowAuthority: 1,
    },
  }
}

function snapshot(rows: SessionRows, revision: number, record?: SessionRecordV2): SessionRowSnapshot {
  const activeThreadId = rows.threads.find((thread) => thread.seq === -1)?.threadId
  const nextRecord = record ?? { ...commit(revision).record, activeThreadId: activeThreadId ?? 'thread-active' }
  return projectRowFixture({ rows, ...commit(revision, nextRecord) })
}

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close()
})

describe('SqlSessionRowStore shared contract on real SQLite', () => {
  for (const contractCase of createSessionRowStoreContract(() => createStore().store)) {
    it(contractCase.name, contractCase.run)
  }
})

describe('SqlSessionRowStore initialization', () => {
  it('creates complete message rows and preserves them when reopened', async () => {
    const { database, store } = createStore()
    const fixture = contextSnapshot({
      id: 'initialization',
      name: 'Initialization',
      messages: [{ id: 'message', role: 'user', contentParts: [{ type: 'text', text: '正文😀\u0000' }] }],
    })
    await store.writeRows(fixture)
    expect(
      await database.query<{ name: string; type: string; notnull: number }>('PRAGMA table_info(session_messages)')
    ).toContainEqual(expect.objectContaining({ name: 'message_json', type: 'TEXT', notnull: 1 }))
    expect(await database.query('SELECT message_json FROM session_messages')).toEqual([
      { message_json: JSON.stringify(fixture.rows.messages[0].message) },
    ])

    const reopened = new SqlSessionRowStore(database)
    await reopened.initialize()
    expect((await reopened.readSnapshot(fixture.record.id))?.rows).toEqual(fixture.rows)
  })

  it('shares initialization and retries a failed schema creation', async () => {
    const { database, store } = createStore()
    const execute = vi.spyOn(database, 'execute').mockRejectedValueOnce(new Error('disk unavailable'))
    const first = store.initialize()
    expect(store.initialize()).toBe(first)
    await expect(first).rejects.toMatchObject({ name: 'SessionRowStoreError', operation: 'initialize' })
    expect(execute).toHaveBeenCalledTimes(1)
    await expect(store.initialize()).resolves.toBeUndefined()
    expect(await store.hasRows('missing')).toBe(false)
  })
})

describe('SqlSessionRowStore SQL shape', () => {
  it('reads fifty short-id ancestors in one bounded query and preserves the exclusive cursor', async () => {
    const { database, store } = createStore()
    const messages = Array.from({ length: 120 }, (_, index) =>
      messageRow('thread-active', `m${index}`, {
        seq: index,
        parentMessageId: index === 0 ? null : `m${index - 1}`,
        activeChildId: index === 119 ? null : `m${index + 1}`,
      })
    )
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active', { rootMessageId: 'm0', activeLeafMessageId: 'm119' })],
          messages,
        },
        1
      )
    )
    database.reset()
    const tail = await store.readTranscriptWindow({ sessionId: 'session-1', limit: 50 })
    expect(tail?.messages).toEqual(messages.slice(-50))
    expect(database.executed.filter((sql) => sql.includes('WITH requested(payload_id, request_index)'))).toHaveLength(1)
    expect(database.executed.some((sql) => sql.startsWith('SELECT substr('))).toBe(false)
    if (!tail?.older) throw new Error('Missing window cursor')
    database.reset()
    const older = await store.readTranscriptWindow({ sessionId: 'session-1', limit: 50, cursor: tail.older })
    expect(older?.messages).toEqual(messages.slice(-100, -50))
    expect(older?.revision).toBe(tail.revision)
    expect(database.executed.filter((sql) => sql.includes('WITH requested(payload_id, request_index)'))).toHaveLength(1)
    database.reset()
    const head = await store.readTranscriptWindow({ sessionId: 'session-1', limit: 50, origin: 'head' })
    expect(head?.messages).toEqual(messages.slice(0, 50))
    expect(head?.older).toBeNull()
    expect(database.executed.filter((sql) => sql.includes('WITH requested(payload_id, request_index)'))).toHaveLength(1)
    if (!head?.newer) throw new Error('Missing forward cursor')
    database.reset()
    const newer = await store.readTranscriptWindow({ sessionId: 'session-1', limit: 50, cursor: head.newer })
    expect(newer?.messages).toEqual(messages.slice(50, 100))
    expect(database.executed.filter((sql) => sql.includes('WITH requested(payload_id, request_index)'))).toHaveLength(1)
  })

  it.each([null, '', '窗口😀', '😀'.repeat(128), '😀'.repeat(129), '界'.repeat(40000)])(
    'preserves small and sliced thread names (case %#)',
    async (name) => {
      const { database, store } = createStore()
      await store.writeRows(
        snapshot(
          {
            sessionId: 'session-1',
            threads: [threadRow('thread-active', { name })],
            messages: [],
          },
          1
        )
      )
      database.reset()
      const result = await store.readSnapshot('session-1')
      expect(result?.rows.threads[0].name).toBe(name)
      const slices = database.executed.filter((sql) => sql.startsWith('SELECT substr(name,'))
      if (name === null || new TextEncoder().encode(name).byteLength <= 512) expect(slices).toHaveLength(0)
      else expect(slices.length).toBeGreaterThan(0)
    }
  )

  it('does not fetch compressed prefix payloads and batches selected context hydration', async () => {
    const { database, store: writer } = createStore()
    const snapshot = contextSnapshot(contextSession(1000))
    await writer.writeRows(snapshot)
    const payloadIds = await database.query<{ message_id: string; payload_id: string }>(
      'SELECT message_id, payload_id FROM session_messages'
    )
    const bodyReads = new Set<string>()
    let bodyBytes = 0
    let payloadQueries = 0
    const reader = new SqlSessionRowStore({
      execute: (sql) => database.execute(sql),
      executeBatch: (statements, options) => database.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const result = await database.query<T>(sql, params)
        if (sql.includes('FROM session_messages JOIN requested') || sql.startsWith('SELECT typeof(message_json)')) {
          payloadQueries += 1
          for (const row of result as Array<{ i: number; v: string }>) {
            bodyReads.add(payloadIds.find((entry) => entry.payload_id === params[row.i])!.message_id)
            bodyBytes += new TextEncoder().encode(row.v).byteLength
          }
        }
        return result
      },
    })
    const context = await readRowContextSource(reader, { sessionId: snapshot.record.id, targetMessageId: 'target' })
    expect(context?.mode).toBe('compacted')
    expect([...bodyReads].sort()).toEqual(['boundary', 'question', 'summary', 'system', 'target'])
    expect(bodyBytes).toBeLessThan(4096)
    expect(payloadQueries).toBeLessThanOrEqual(3)
    expect(JSON.stringify(snapshot.rows.messages).length).toBeGreaterThan(1_000_000)
    bodyReads.clear()
    await reader.readMessages({ sessionId: snapshot.record.id, messageIds: ['question'] })
    expect([...bodyReads]).toEqual(['question'])
  })

  it.each([false, true])(
    'keeps context reads consistent across a commit during payload hydration (pinned: %s)',
    async (pinned) => {
      const { database, store: writer } = createStore()
      const snapshot = contextSnapshot()
      await writer.writeRows(snapshot)
      let mutated = false
      const reader = new SqlSessionRowStore({
        execute: (sql) => database.execute(sql),
        executeBatch: (statements, options) => database.executeBatch(statements, options),
        query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
          const result = await database.query<T>(sql, params)
          if (!mutated && sql.includes('FROM session_messages JOIN requested')) {
            mutated = true
            await writer.writeRows(
              { ...snapshot, record: { ...snapshot.record, name: 'new revision' }, revision: 2 },
              1
            )
          }
          return result
        },
      })
      const read = readRowContextSource(reader, {
        sessionId: snapshot.record.id,
        targetMessageId: 'target',
        expectedRevision: pinned ? 1 : undefined,
      })
      if (pinned) await expect(read).rejects.toMatchObject({ name: 'SessionRowConflictError', actualRevision: 2 })
      else await expect(read).rejects.toMatchObject({ name: 'SessionRowConflictError', actualRevision: 2 })
    }
  )
  it('encodes small message payloads with bounded UTF-8 allocations per message', async () => {
    const { store } = createStore()
    const messages = Array.from({ length: 1000 }, (_, index) => messageRow('thread-active', `message-${index}`))
    const encoding = vi.spyOn(TextEncoder.prototype, 'encode')
    try {
      await store.writeRows(snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages }, 1))
      expect(encoding.mock.calls.length).toBeLessThan(messages.length * 10)
    } finally {
      encoding.mockRestore()
    }
  })

  it.each([false, true])('handles a commit during window payload hydration (cursor: %s)', async (withCursor) => {
    const { database, store: writer } = createStore()
    const rows: SessionRows = {
      sessionId: 'session-1',
      threads: [threadRow('thread-active', { rootMessageId: 'm1', activeLeafMessageId: 'm2' })],
      messages: [
        messageRow('thread-active', 'm1', { activeChildId: 'm2' }),
        messageRow('thread-active', 'm2', { seq: 1, parentMessageId: 'm1' }),
      ],
    }
    await writer.writeRows(snapshot(rows, 1))
    const tail = await writer.readTranscriptWindow({ sessionId: 'session-1', limit: 1 })
    const cursor = withCursor ? (tail?.older ?? undefined) : undefined
    let mutated = false
    const reader = new SqlSessionRowStore({
      execute: (sql) => database.execute(sql),
      executeBatch: (statements, options) => database.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const result = await database.query<T>(sql, params)
        if (sql.includes('WITH requested(payload_id, request_index)') && !mutated) {
          mutated = true
          await writer.applyDiff(
            {
              sessionId: 'session-1',
              threads: { upsert: [], delete: [] },
              messages: {
                upsert: rows.messages.map((row) => ({
                  ...row,
                  message: { ...row.message, contentParts: [{ type: 'text', text: 'new' }] },
                })),
                delete: [],
              },
            },
            { ...commit(2), record: { ...commit(2).record, name: 'new' } },
            1
          )
        }
        return result
      },
    })
    const read = reader.readTranscriptWindow({ sessionId: 'session-1', limit: withCursor ? 1 : 2, cursor })
    if (withCursor) {
      await expect(read).rejects.toMatchObject({
        name: 'SessionRowConflictError',
        expectedRevision: 1,
        actualRevision: 2,
      })
    } else {
      const window = await read
      expect(window?.revision).toBe(2)
      expect(window?.record.name).toBe('new')
      expect(window?.messages.map((row) => row.message.contentParts)).toEqual([
        [{ type: 'text', text: 'new' }],
        [{ type: 'text', text: 'new' }],
      ])
    }
    expect(mutated).toBe(true)
  })

  it('hydrates only the requested window and keeps native responses bounded for large ids and payloads', async () => {
    const { database, store: writer } = createStore()
    const id = (index: number) => `${String(index).padStart(4, '0')}${'\u0001'.repeat(1000)}`
    const messages = Array.from({ length: 50 }, (_, index) =>
      messageRow('thread-active', id(index), {
        seq: index,
        parentMessageId: index === 0 ? null : id(index - 1),
        activeChildId: index === 49 ? null : id(index + 1),
        message: { id: id(index), role: 'user', contentParts: [{ type: 'text', text: '中文😀'.repeat(35_000) }] },
      })
    )
    await writer.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active', { rootMessageId: id(0), activeLeafMessageId: id(49) })],
          messages,
        },
        1
      )
    )
    const manifests = await database.query<{ payload_id: string; message_id: string }>(
      'SELECT payload_id,message_id FROM session_messages'
    )
    const identities = new Map(manifests.map((row) => [row.payload_id, row.message_id]))
    const hydrated = new Set<string>()
    const reader = new SqlSessionRowStore({
      execute: (sql) => database.execute(sql),
      executeBatch: (statements, options) => database.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const result = await database.query<T>(sql, params)
        expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(512 * 1024)
        expect(sql).not.toMatch(/OFFSET \d/)
        if (sql.includes('FROM session_messages JOIN requested') || sql.startsWith('SELECT typeof(message_json)')) {
          for (const param of params)
            if (typeof param === 'string' && identities.has(param)) hydrated.add(identities.get(param)!)
          const escapedResponse = JSON.stringify({ values: result }).replace(
            /[\u007f-\uffff<>&/]/g,
            (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
          )
          expect(new TextEncoder().encode(escapedResponse).byteLength).toBeLessThan(384 * 1024)
        }
        return result
      },
    })
    const tail = await reader.readTranscriptWindow({ sessionId: 'session-1', limit: 9 })
    const count = tail!.messages.length
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(9)
    expect(tail?.payloadBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(tail?.messages).toEqual(messages.slice(-count))
    expect([...hydrated].sort()).toEqual(tail!.messages.map((row) => row.messageId).sort())
    if (!tail?.older) throw new Error('expected cursor')
    hydrated.clear()
    const older = await reader.readTranscriptWindow({ sessionId: 'session-1', limit: 9, cursor: tail.older })
    expect(older?.messages).toEqual(messages.slice(-count - older!.messages.length, -count))
    expect([...hydrated].sort()).toEqual(older!.messages.map((row) => row.messageId).sort())
  })

  it('scans message references by status without selecting the payload column', async () => {
    const { database, store } = createStore()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [
            messageRow('thread-active', 'm1'),
            messageRow('thread-active', 'm2', { seq: 1, status: 'generating' }),
          ],
        },
        1
      )
    )
    database.reset()

    await expect(store.findMessagesByStatus('generating')).resolves.toEqual([
      { sessionId: 'session-1', threadId: 'thread-active', messageId: 'm2' },
    ])
    expect(database.executed).toHaveLength(1)
    expect(database.executed[0]).not.toContain('message_json')
  })

  it('publishes staged row changes with one revision commit', async () => {
    const { database, store } = createStore()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [messageRow('thread-active', 'm1')],
        },
        1
      )
    )
    database.reset()

    await store.applyDiff(
      {
        sessionId: 'session-1',
        threads: {
          upsert: [threadRow('thread-active', { name: 'Renamed', rootMessageId: 'm2', activeLeafMessageId: 'm2' })],
          delete: [],
        },
        messages: { upsert: [messageRow('thread-active', 'm2', { seq: 1 })], delete: ['m1'] },
      },
      commit(2),
      1
    )

    expect(database.executed.filter((sql) => sql.startsWith('INSERT OR REPLACE INTO session_row_heads'))).toHaveLength(
      1
    )
    expect((await store.readSnapshot('session-1'))?.rows.messages.map((row) => row.messageId)).toEqual(['m2'])
  })

  it('rejects a conditional diff after another commit advances the revision', async () => {
    const { store } = createStore()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [],
        },
        1
      )
    )
    await store.applyDiff(
      {
        sessionId: 'session-1',
        threads: { upsert: [threadRow('thread-active', { name: 'Current' })], delete: [] },
        messages: { upsert: [], delete: [] },
      },
      commit(2),
      1
    )

    await expect(
      store.applyDiff(
        {
          sessionId: 'session-1',
          threads: { upsert: [threadRow('thread-active', { name: 'Stale' })], delete: [] },
          messages: { upsert: [], delete: [] },
        },
        commit(2),
        1
      )
    ).rejects.toMatchObject({
      name: 'SessionRowConflictError',
      expectedRevision: 1,
      actualRevision: 2,
    })
    await expect(store.readSnapshot('session-1')).resolves.toMatchObject({
      rows: { threads: [expect.objectContaining({ name: 'Current' })] },
      revision: 2,
    })
  })

  it('rejects an invalid diff before publishing any row changes', async () => {
    const { database, store } = createStore()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [messageRow('thread-active', 'm1')],
        },
        1
      )
    )
    database.reset()

    await expect(
      store.applyDiff(
        {
          sessionId: 'session-1',
          threads: { upsert: [], delete: [] },
          messages: { upsert: [messageRow('thread-active', '')], delete: ['m1'] },
        },
        commit(2),
        1
      )
    ).rejects.toMatchObject({ name: 'SessionRowStoreError', operation: 'apply-diff' })

    expect(await store.getRevision('session-1')).toBe(1)
    expect((await store.readSnapshot('session-1'))?.rows.messages.map((row) => row.messageId)).toEqual(['m1'])
  })

  it('reads messages back ordered by thread and sequence', async () => {
    const { store } = createStore()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-a'), threadRow('thread-b', { seq: 0 })],
          messages: [
            messageRow('thread-b', 'b2', { seq: 1 }),
            messageRow('thread-a', 'a2', { seq: 1 }),
            messageRow('thread-b', 'b1'),
            messageRow('thread-a', 'a1'),
          ],
        },
        1
      )
    )

    const rows = (await store.readSnapshot('session-1'))?.rows

    expect(rows?.messages.map((row) => row.messageId)).toEqual(['a1', 'a2', 'b1', 'b2'])
  })

  it('round-trips an optional prompt context snapshot without turning absence into null', async () => {
    const { store } = createStore()
    const promptSnapshot = {
      version: 1,
      soul: 'soul document',
      memories: [],
      workspaceInstructions: 'instructions',
      workspaceDirectories: ['/tmp/session-1'],
      capturedAt: 1_500,
    }
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [
            threadRow('thread-plain'),
            threadRow('thread-snapshot', { seq: 0, sessionPromptContextSnapshot: promptSnapshot }),
          ],
          messages: [],
        },
        1
      )
    )

    const rows = (await store.readSnapshot('session-1'))?.rows
    const plain = rows?.threads.find((thread) => thread.threadId === 'thread-plain')
    const withSnapshot = rows?.threads.find((thread) => thread.threadId === 'thread-snapshot')

    expect(plain && 'sessionPromptContextSnapshot' in plain).toBe(false)
    expect(withSnapshot?.sessionPromptContextSnapshot).toEqual(promptSnapshot)
  })

  it('round-trips a multi-megabyte unicode message through one stored message', async () => {
    const { store } = createStore()
    const text = `${'中文😀\\'.repeat(256 * 1024)}tail`
    const row = messageRow('thread-active', 'huge', {
      message: { id: 'huge', role: 'user', contentParts: [{ type: 'text', text }] },
    })

    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [row],
        },
        1
      )
    )

    expect((await store.readSnapshot('session-1'))?.rows.messages).toEqual([row])
  })

  it.each(['ASCII', 'Unicode'])('bounds payload slices even when %s characters are JSON-escaped', async (kind) => {
    const { database, store: writer } = createStore()
    const text = kind === 'ASCII' ? '\\"'.repeat(70_000) : '𠀀\u0080'.repeat(40_000)
    const row = messageRow('thread-active', 'large', {
      message: { id: 'large', role: 'user', contentParts: [{ type: 'text', text }] },
    })
    await writer.writeRows(
      snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages: [row] }, 1)
    )
    let slices = 0
    const reader = new SqlSessionRowStore({
      execute: (sql) => database.execute(sql),
      executeBatch: (statements, options) => database.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const rows = await database.query<T>(sql, params)
        // Also cover serializers that escape every non-ASCII UTF-16 code unit.
        const escaped = JSON.stringify(rows).replace(
          /[\u007f-\uffff]/g,
          (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
        )
        expect(new TextEncoder().encode(escaped).byteLength).toBeLessThan(384 * 1024)
        if (sql.startsWith('SELECT typeof(message_json)')) {
          slices += 1
          expect(params[1]).toBe(Math.floor((384 * 1024 - 1024) / 12))
          expect(rows).toHaveLength(1)
          expect(rows[0]).not.toHaveProperty('payload_id')
        }
        return rows
      },
    })
    expect((await reader.readMessages({ sessionId: 'session-1', messageIds: ['large'] }))?.messages).toEqual([row])
    expect(slices).toBeGreaterThan(1)
  })

  it.each([false, true])('keeps a replacement between payload slices revision-bound (pinned: %s)', async (pinned) => {
    const { database, store: writer } = createStore()
    const row = messageRow('thread-active', 'large', {
      message: { id: 'large', role: 'user', contentParts: [{ type: 'text', text: 'x'.repeat(100_000) }] },
    })
    const next = { ...row, message: { ...row.message, contentParts: [{ type: 'text' as const, text: 'new' }] } }
    await writer.writeRows(
      snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages: [row] }, 1)
    )
    let mutated = false
    const reader = new SqlSessionRowStore({
      execute: (sql) => database.execute(sql),
      executeBatch: (statements, options) => database.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const rows = await database.query<T>(sql, params)
        if (!mutated && sql.startsWith('SELECT typeof(message_json)')) {
          mutated = true
          await writer.applyDiff(
            {
              sessionId: 'session-1',
              threads: { upsert: [], delete: [] },
              messages: { upsert: [next], delete: [] },
            },
            commit(2),
            1
          )
        }
        return rows
      },
    })
    const read = reader.readMessages({
      sessionId: 'session-1',
      messageIds: ['large'],
      expectedRevision: pinned ? 1 : undefined,
    })
    if (pinned) await expect(read).rejects.toMatchObject({ name: 'SessionRowConflictError', actualRevision: 2 })
    else await expect(read).resolves.toMatchObject({ revision: 2, messages: [next] })
    expect(mutated).toBe(true)
  })

  it('keeps every SQLite read response bounded while hydrating large thread JSON', async () => {
    const underlying = openNodeSessionRowDatabase()
    openDatabases.push(underlying)
    const responseLimit = 512 * 1024
    const database: SessionRowSqlDatabase = {
      execute: (sql) => underlying.execute(sql),
      executeBatch: (statements, options) => underlying.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const rows = await underlying.query<T>(sql, params)
        if (new TextEncoder().encode(JSON.stringify(rows)).byteLength > responseLimit) {
          throw new Error('SQLite bridge response exceeded its limit')
        }
        return rows
      },
    }
    const store = new SqlSessionRowStore(database)
    const largeText = '\\'.repeat(600 * 1024)
    const record = {
      id: 'session-1',
      type: 'chat',
      name: largeText,
      activeThreadId: 'thread-active',
      storageFormat: 'rows',
      rowFormatVersion: 3,
      rowAuthority: 1,
    } satisfies SessionRecordV2
    const thread = threadRow('thread-active', {
      name: largeText,
      sessionPromptContextSnapshot: {
        version: 1,
        soul: largeText,
        memories: [],
        workspaceInstructions: largeText,
        workspaceDirectories: [],
        capturedAt: 1_000,
      },
    })
    await store.writeRows(snapshot({ sessionId: 'session-1', threads: [thread], messages: [] }, 1, record), null)

    await expect(store.readSnapshot('session-1')).resolves.toEqual({
      rows: { sessionId: 'session-1', threads: [thread], messages: [] },
      record,
      revision: 1,
      textTokens: { sources: {}, results: [] },
    })
  })

  it('plans bounded metadata pages without one bridge query per handful of messages', async () => {
    const underlying = openNodeSessionRowDatabase()
    openDatabases.push(underlying)
    const responseLimit = 512 * 1024
    let metadataPageQueries = 0
    const database: SessionRowSqlDatabase = {
      execute: (sql) => underlying.execute(sql),
      executeBatch: (statements, options) => underlying.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const rows = await underlying.query<T>(sql, params)
        if (sql.includes('AS response_bytes') && !sql.startsWith('WITH requested(payload_id, request_index)')) {
          metadataPageQueries++
          // Planning a page must not rescan every message after the current cursor.
          expect(sql).not.toMatch(/OFFSET \d/)
          expect(params.at(-2)).toBeLessThanOrEqual(768)
        }
        expect(new TextEncoder().encode(JSON.stringify(rows)).byteLength).toBeLessThanOrEqual(responseLimit)
        return rows
      },
    }
    const store = new SqlSessionRowStore(database)
    const messages = Array.from({ length: 10_000 }, (_, index) =>
      messageRow('thread-active', `message-${index.toString().padStart(5, '0')}`, { seq: index })
    )
    await store.writeRows(snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages }, 1))

    const rows = (await store.readSnapshot('session-1'))?.rows

    expect(rows?.messages).toHaveLength(messages.length)
    expect(metadataPageQueries).toBeLessThan(100)
  }, 30_000)

  it('continues metadata pages across equal sequences and thread boundaries', async () => {
    const { store } = createStore()
    const messages = ['thread-a', 'thread-b'].flatMap((threadId) =>
      Array.from({ length: 900 }, (_, index) =>
        messageRow(threadId, `${threadId}-${String(index).padStart(4, '0')}`, { seq: Math.floor(index / 450) })
      )
    )
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-a'), threadRow('thread-b', { seq: 0 })],
          messages: [...messages].reverse(),
        },
        1
      )
    )

    expect((await store.readSnapshot('session-1'))?.rows.messages).toEqual(messages)
  })

  it('bounds full snapshot metadata responses with escaped structural ids', async () => {
    const { database } = createStore()
    const messages = Array.from({ length: 100 }, (_, index) =>
      messageRow('thread-active', `${String(index).padStart(4, '0')}${'\u0001'.repeat(1000)}`, { seq: index })
    )
    const store = new SqlSessionRowStore({
      execute: (sql) => database.execute(sql),
      executeBatch: (statements, options) => database.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const rows = await database.query<T>(sql, params)
        expect(new TextEncoder().encode(JSON.stringify(rows)).byteLength).toBeLessThanOrEqual(512 * 1024)
        return rows
      },
    })
    await store.writeRows(snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages }, 1))
    expect((await store.readSnapshot('session-1'))?.rows.messages).toEqual(messages)
  })

  it('bounds forward window responses with escaped ids and preserves continuation order', async () => {
    const { database } = createStore()
    const ids = Array.from({ length: 120 }, (_, index) => `${String(index).padStart(4, '0')}${'\u0001'.repeat(1000)}`)
    const messages = ids.map((id, index) =>
      messageRow('thread-active', id, {
        seq: index,
        parentMessageId: ids[index - 1] ?? null,
        activeChildId: ids[index + 1] ?? null,
      })
    )
    const store = new SqlSessionRowStore({
      execute: (sql) => database.execute(sql),
      executeBatch: (statements, options) => database.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const rows = await database.query<T>(sql, params)
        expect(new TextEncoder().encode(JSON.stringify(rows)).byteLength).toBeLessThanOrEqual(384 * 1024)
        return rows
      },
    })
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active', { rootMessageId: ids[0], activeLeafMessageId: ids.at(-1)! })],
          messages,
        },
        1
      )
    )
    let window = await store.readTranscriptWindow({ sessionId: 'session-1', origin: 'head', limit: 50 })
    const selected = [...window!.messages]
    while (window?.newer) {
      window = await store.readTranscriptWindow({ sessionId: 'session-1', cursor: window.newer, limit: 50 })
      selected.push(...window!.messages)
    }
    expect(selected).toEqual(messages)
  })

  it('reports a read failure as a store error when a stored message is corrupt', async () => {
    const { database, store } = createStore()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [messageRow('thread-active', 'm1')],
        },
        1
      )
    )
    await database.executeBatch([
      {
        sql: 'UPDATE session_messages SET message_json = ? WHERE message_id = ?',
        params: ['{broken', 'm1'],
      },
    ])

    await expect(store.readSnapshot('session-1')).rejects.toMatchObject({
      name: 'SessionRowStoreError',
      operation: 'read-rows',
      sessionId: 'session-1',
    })
  })

  it('retries when a concurrent publish replaces complete messages during a read', async () => {
    const underlying = openNodeSessionRowDatabase()
    openDatabases.push(underlying)
    let advanceRevision: (() => Promise<unknown>) | null = null
    const database: SessionRowSqlDatabase = {
      execute: (sql) => underlying.execute(sql),
      executeBatch: (statements, options) => underlying.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        if (advanceRevision && sql.includes('FROM session_messages JOIN requested')) {
          const advance = advanceRevision
          advanceRevision = null
          await advance()
        }
        return await underlying.query<T>(sql, params)
      },
    }
    const store = new SqlSessionRowStore(database)
    const currentMessage = messageRow('thread-active', 'm1', {
      updatedAt: 2_000,
      message: { id: 'm1', role: 'user', contentParts: [{ type: 'text', text: 'current payload' }] },
    })
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [messageRow('thread-active', 'm1')],
        },
        1
      )
    )
    advanceRevision = () =>
      store.applyDiff(
        {
          sessionId: 'session-1',
          threads: { upsert: [threadRow('thread-active')], delete: [] },
          messages: { upsert: [currentMessage], delete: [] },
        },
        commit(2),
        1
      )

    await expect(store.readSnapshot('session-1')).resolves.toMatchObject({
      rows: { messages: [currentMessage] },
      revision: 2,
    })
  })
})

describe('metadata-only payload reuse', () => {
  it('preserves payload identity and contents under CAS, but replaces changed contents', async () => {
    const { store, database } = createStore()
    const row = messageRow('thread-active', 'm1', {
      message: { id: 'm1', role: 'user', contentParts: [{ type: 'text', text: '正文'.repeat(100000) }] },
    })
    await store.writeRows(
      snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages: [row] }, 1)
    )
    const manifest = () => database.query('SELECT payload_id, message_json, payload_utf8_length FROM session_messages')
    const before = await manifest()
    database.reset()
    const diff: SessionRowsDiff = {
      sessionId: 'session-1',
      threads: { upsert: [], delete: [] },
      messages: { upsert: [], delete: [] },
      messageMetadataUpsert: [(({ message: _message, ...metadata }) => ({ ...metadata, seq: 42 }))(row)],
    }
    await store.applyDiff(diff, commit(2), 1)
    expect(database.executed.some((sql) => sql.startsWith('INSERT INTO session_message_payload_chunks'))).toBe(false)
    expect(await manifest()).toEqual(before)
    expect((await store.readSnapshot('session-1'))?.rows.messages[0]).toEqual({ ...row, seq: 42 })
    await expect(store.applyDiff(diff, commit(3), 1)).rejects.toThrow('revision conflict')
    expect(await manifest()).toEqual(before)
    await store.applyDiff(
      {
        ...diff,
        messageMetadataUpsert: undefined,
        messages: {
          upsert: [{ ...row, message: { ...row.message, contentParts: [{ type: 'text', text: 'edited' }] } }],
          delete: [],
        },
      },
      commit(3),
      2
    )
    expect(await manifest()).not.toEqual(before)
    expect((await store.readSnapshot('session-1'))?.rows.messages[0].message.contentParts).toEqual([
      { type: 'text', text: 'edited' },
    ])
  })

  it('requires the original row and rolls back a missing payload source', async () => {
    const { store } = createStore()
    await store.writeRows(snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages: [] }, 1))
    await expect(
      store.applyDiff(
        {
          sessionId: 'session-1',
          threads: { upsert: [], delete: [] },
          messages: { upsert: [], delete: [] },
          messageMetadataUpsert: [
            (({ message: _message, ...metadata }) => metadata)(messageRow('thread-active', 'missing')),
          ],
        },
        commit(2),
        1
      )
    ).rejects.toThrow()
    expect((await store.readSnapshot('session-1'))?.revision).toBe(1)
  })

  it('requires a revision for local metadata mutations', async () => {
    const { store } = createStore()
    const initial = snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages: [] }, 1)
    await store.writeRows(initial)
    await expect(
      store.applyDiff(
        { sessionId: 'session-1', threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: [] } },
        commit(2)
      )
    ).rejects.toMatchObject({ cause: { message: 'Local row edits require an expected revision' } })
    expect(await store.getRevision('session-1')).toBe(1)
  })
})

describe('SqlSessionRowStore search thread paging', () => {
  it('pages active then reversed history identities without hydrating compaction or message payloads', async () => {
    const { database, store } = createStore()
    const archived = Array.from({ length: 45 }, (_, index) =>
      threadRow(`history-${index}`, {
        seq: index,
        compactionPoints: [{ summaryMessageId: 's'.repeat(80_000), boundaryMessageId: 'b', createdAt: 1 }],
      })
    )
    await store.writeRows(
      snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active'), ...archived], messages: [] }, 1)
    )
    const readSnapshot = vi.spyOn(store, 'readSnapshot')
    const queries: Array<{ sql: string; params: SessionRowSqlBindValue[]; count: number }> = []
    const query = database.query.bind(database)
    vi.spyOn(database, 'query').mockImplementation(async <T>(sql: string, params: SessionRowSqlBindValue[] = []) => {
      const rows = await query<T>(sql, params)
      queries.push({ sql, params, count: rows.length })
      return rows
    })
    const ids: string[] = []
    let page = await store.readThreadsPage({ sessionId: 'session-1', limit: 7 })
    while (page) {
      expect(page.threadIds.length).toBeLessThanOrEqual(7)
      ids.push(...page.threadIds)
      if (!page.nextCursor) break
      page = await store.readThreadsPage({ sessionId: 'session-1', limit: 7, cursor: page.nextCursor })
    }
    expect(ids).toEqual(['thread-active', ...archived.reverse().map((thread) => thread.threadId)])
    expect(readSnapshot).not.toHaveBeenCalled()
    expect(queries.some(({ sql }) => sql.includes('substr(compaction_points_json'))).toBe(false)
    expect(queries.some(({ sql }) => sql.includes('FROM session_messages'))).toBe(false)
    const pages = queries.filter(({ sql }) => sql.startsWith('WITH page AS'))
    expect(pages).toHaveLength(7)
    expect(pages.every(({ params, count }) => params[1] === 8 && count <= 8)).toBe(true)
  })

  it('rejects stale history enumeration and first-message reads after a commit', async () => {
    const { store } = createStore()
    const initial = snapshot(
      { sessionId: 'session-1', threads: [threadRow('thread-active'), threadRow('old', { seq: 0 })], messages: [] },
      1
    )
    await store.writeRows(initial)
    const first = await store.readThreadsPage({ sessionId: 'session-1', limit: 1 })
    if (!first?.nextCursor) throw new Error('Expected thread cursor')
    await store.writeRows({ ...initial, revision: 2 }, 1)
    await expect(
      store.readThreadsPage({ sessionId: 'session-1', limit: 1, cursor: first.nextCursor })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
    await expect(
      store.readTranscriptWindow({
        sessionId: 'session-1',
        origin: { threadId: 'old', edge: 'head' },
        limit: 1,
        expectedRevision: first.revision,
      })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
  })

  it('caps escaped thread identity response bytes and resumes at the actual page boundary', async () => {
    const { database, store } = createStore()
    const archived = Array.from({ length: 100 }, (_, index) =>
      threadRow(`history-${index}-${'\\'.repeat(960)}`, { seq: index })
    )
    await store.writeRows(
      snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active'), ...archived], messages: [] }, 1)
    )
    const query = database.query.bind(database)
    const responseBytes: number[] = []
    vi.spyOn(database, 'query').mockImplementation(async <T>(sql: string, params: SessionRowSqlBindValue[] = []) => {
      const rows = await query<T>(sql, params)
      if (sql.startsWith('WITH page AS')) responseBytes.push(new TextEncoder().encode(JSON.stringify(rows)).length)
      return rows
    })
    const ids: string[] = []
    let page = await store.readThreadsPage({ sessionId: 'session-1', limit: 200 })
    expect(page?.threadIds.length).toBeLessThan(101)
    while (page) {
      ids.push(...page.threadIds)
      if (!page.nextCursor) break
      page = await store.readThreadsPage({ sessionId: 'session-1', limit: 200, cursor: page.nextCursor })
    }
    expect(ids).toEqual(['thread-active', ...archived.reverse().map((thread) => thread.threadId)])
    expect(responseBytes.every((bytes) => bytes < 384 * 1024)).toBe(true)
  })
})
