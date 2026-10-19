import { SESSION_TOKEN_CACHE_SQL } from '../../../../packages/chatbox-core/src/persistence/session-token-cache-sql'
import { projectRowFixture } from '../../../../packages/chatbox-core/src/ports/testing/session-row-fixtures'
import {
  openNodeSessionRowDatabase,
  type NodeSessionRowSqlDatabase,
} from '../../../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import type { SessionRowSqlBindValue } from '@chatbox/core'
import { SESSION_TRANSCRIPT_SCHEMA_SQL } from '@chatbox/core/persistence'
import { CAPACITOR_MESSAGE_ROWS_SCHEMA_SQL } from '@chatbox/core'
import type { SessionRowCommit, SessionRowSnapshot, SessionRows } from '@chatbox/core/ports'
import type { MessageRow, ThreadRow } from '@chatbox/core/session/session-tree'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_TEXT_TOKEN_SCHEMA_SQL } from '../../../../packages/chatbox-core/src/persistence/session-text-token-sql'
import { SQLiteSessionRowStore } from '../SQLiteSessionRowStorage'

const mockDatabase = vi.hoisted(() => ({
  open: vi.fn(),
  execute: vi.fn(),
  run: vi.fn(),
  executeSet: vi.fn(),
  beginTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  query: vi.fn(),
  close: vi.fn(),
}))

const mockConnection = vi.hoisted(() => ({
  closeConnection: vi.fn(),
  createConnection: vi.fn(),
}))

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  // biome-ignore lint/complexity/useArrowFunction: SQLiteConnection is constructed with new.
  SQLiteConnection: vi.fn(function () {
    return mockConnection
  }),
}))

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

function messageRow(messageId: string, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    sessionId: 'session-1',
    threadId: 'thread-active',
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

function commit(revision: number): SessionRowCommit {
  return {
    revision,
    record: {
      id: 'session-1',
      type: 'chat',
      name: 'session-1',
      activeThreadId: 'thread-active',
      storageFormat: 'rows',
    },
  }
}

function snapshot(rows: SessionRows, revision = 1): SessionRowSnapshot {
  return { rows, ...commit(revision) }
}

function statementsOf(call: number): string[] {
  const set = mockDatabase.executeSet.mock.calls[call][0] as Array<{ statement: string }>
  return set.map((entry) => entry.statement)
}

function insertedRows(table: string): unknown[][] {
  return mockDatabase.executeSet.mock.calls.flatMap((call) =>
    (call[0] as Array<{ statement: string; values: unknown[] }>)
      .filter((entry) => entry.statement.startsWith(`INSERT OR REPLACE INTO ${table} (`))
      .flatMap((entry) => {
        const width = entry.statement
          .slice(entry.statement.indexOf('(') + 1, entry.statement.indexOf(')'))
          .split(',').length
        return Array.from({ length: entry.values.length / width }, (_, index) =>
          entry.values.slice(index * width, (index + 1) * width)
        )
      })
  )
}

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
function realBridge() {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  mockDatabase.execute.mockImplementation((sql: string) => database.execute(sql))
  mockDatabase.query.mockImplementation(async (sql: string, params: SessionRowSqlBindValue[] = []) => ({
    values: await database.query(sql, params),
  }))
  mockDatabase.executeSet.mockImplementation(
    async (batch: Array<{ statement: string; values: SessionRowSqlBindValue[] }>, transaction: boolean) => {
      expect(transaction).toBe(true)
      await database.executeBatch(batch.map((row) => ({ sql: row.statement, params: row.values })))
      return { changes: { changes: 1 } }
    }
  )
  return new SQLiteSessionRowStore()
}

describe('SQLiteSessionRowStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConnection.closeConnection.mockResolvedValue(undefined)
    mockConnection.createConnection.mockResolvedValue(mockDatabase)
    mockDatabase.open.mockResolvedValue(undefined)
    mockDatabase.execute.mockResolvedValue({ changes: { changes: 0 } })
    mockDatabase.executeSet.mockResolvedValue({ changes: { changes: 1 } })
    mockDatabase.beginTransaction.mockResolvedValue({ changes: { changes: 0 } })
    mockDatabase.commitTransaction.mockResolvedValue({ changes: { changes: 0 } })
    mockDatabase.rollbackTransaction.mockResolvedValue({ changes: { changes: 0 } })
    mockDatabase.query.mockResolvedValue({ values: [] })
  })

  it('creates the row tables once on repeated initialization', async () => {
    const store = new SQLiteSessionRowStore()

    await store.initialize()
    await store.initialize()

    expect(mockConnection.createConnection).toHaveBeenCalledWith('chatbox-messages', false, 'no-encryption', 1, false)
    expect(
      mockDatabase.execute.mock.calls.filter(([sql]) =>
        String(sql).includes('CREATE TABLE IF NOT EXISTS session_threads (')
      )
    ).toHaveLength(1)
    const sql = mockDatabase.execute.mock.calls[0][0] as string
    expect(sql.replace(/\s+/g, ' ').trim()).toBe(
      (
        CAPACITOR_MESSAGE_ROWS_SCHEMA_SQL +
        SESSION_TEXT_TOKEN_SCHEMA_SQL +
        SESSION_TRANSCRIPT_SCHEMA_SQL +
        SESSION_TOKEN_CACHE_SQL
      )
        .replace(/\s+/g, ' ')
        .trim()
    )
    expect(sql).toContain(';\nCREATE TABLE')
  })

  it('waits for a previous connection to close before creating a replacement', async () => {
    let releaseClose: () => void = () => {}
    mockConnection.closeConnection.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseClose = resolve
        })
    )
    const store = new SQLiteSessionRowStore()

    const initialization = store.initialize()
    await vi.waitFor(() => expect(mockConnection.closeConnection).toHaveBeenCalledOnce())
    expect(mockConnection.createConnection).not.toHaveBeenCalled()

    releaseClose()
    await initialization
    expect(mockConnection.createConnection).toHaveBeenCalledOnce()
  })

  it('continues opening when closing a missing connection rejects asynchronously', async () => {
    mockConnection.closeConnection.mockRejectedValueOnce(new Error('connection does not exist'))
    const store = new SQLiteSessionRowStore()

    await expect(store.initialize()).resolves.toBeUndefined()

    expect(mockConnection.createConnection).toHaveBeenCalledOnce()
    expect(mockDatabase.open).toHaveBeenCalledOnce()
  })

  it('publishes a whole session from staging in one final transaction', async () => {
    const store = new SQLiteSessionRowStore()

    await store.writeRows(
      snapshot({
        sessionId: 'session-1',
        threads: [threadRow('thread-active')],
        messages: [messageRow('m1'), messageRow('m2', { seq: 1, parentMessageId: 'm1' })],
      })
    )

    expect(mockDatabase.executeSet).toHaveBeenCalledTimes(3)
    expect(mockDatabase.executeSet.mock.calls.every((call) => call[1] === true)).toBe(true)
    expect(statementsOf(0)).toEqual([
      'INSERT INTO session_row_staging_mutations (mutation_id, created_at) VALUES (?, ?)',
      'DELETE FROM session_threads_staging WHERE mutation_id = ?',
      'DELETE FROM session_messages_staging WHERE mutation_id = ?',
    ])
    expect(statementsOf(1)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('INSERT OR REPLACE INTO session_threads_staging'),
        expect.stringContaining('INSERT OR REPLACE INTO session_messages_staging'),
      ])
    )
    expect(statementsOf(2)).toEqual(
      expect.arrayContaining([
        'DELETE FROM session_threads WHERE session_id = ?',
        'DELETE FROM session_messages WHERE session_id = ?',
        expect.stringContaining('INSERT INTO session_threads'),
        expect.stringContaining('INSERT INTO session_messages'),
      ])
    )
    expect(mockDatabase.run).not.toHaveBeenCalled()
  })

  it('publishes local edits atomically without replacing unrelated session rows', async () => {
    const store = realBridge()
    const initial = projectRowFixture(
      snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages: [messageRow('m1')] })
    )
    await store.writeRows(initial)
    mockDatabase.executeSet.mockClear()
    const changed = {
      ...initial.rows.messages[0],
      message: { ...initial.rows.messages[0].message, contentParts: [{ type: 'text' as const, text: 'edited' }] },
    }
    await store.applyDiff(
      { sessionId: 'session-1', threads: { upsert: [], delete: [] }, messages: { upsert: [changed], delete: [] } },
      { ...initial, revision: 2 },
      1
    )
    expect(mockDatabase.executeSet.mock.calls.every((call) => call[1] === true)).toBe(true)
    const statements = mockDatabase.executeSet.mock.calls.flatMap((_call, index) => statementsOf(index))
    expect(statements).toContainEqual(expect.stringContaining('session_row_revision_guard'))
    expect(statements).not.toContain('DELETE FROM session_messages WHERE session_id = ?')
    expect(
      (await store.readMessages({ sessionId: 'session-1', messageIds: ['m1'] }))?.messages[0].message.contentParts
    ).toEqual(changed.message.contentParts)
    expect(await store.getRevision('session-1')).toBe(2)
  })

  it('stages oversized local edits within each native bridge budget', async () => {
    const store = realBridge()
    const initial = projectRowFixture(
      snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages: [messageRow('m1')] })
    )
    await store.writeRows(initial)
    mockDatabase.executeSet.mockClear()
    const changed = {
      ...initial.rows.messages[0],
      message: {
        ...initial.rows.messages[0].message,
        contentParts: [{ type: 'text' as const, text: 'x'.repeat(600 * 1024) }],
      },
    }
    await store.applyDiff(
      { sessionId: 'session-1', threads: { upsert: [], delete: [] }, messages: { upsert: [changed], delete: [] } },
      { ...initial, revision: 2 },
      1
    )
    expect(mockDatabase.executeSet.mock.calls.length).toBeGreaterThan(3)
    for (const call of mockDatabase.executeSet.mock.calls) {
      expect(call[1]).toBe(true)
      expect(new TextEncoder().encode(JSON.stringify(call[0])).byteLength).toBeLessThanOrEqual(480 * 1024)
    }
    expect(
      (await store.readMessages({ sessionId: 'session-1', messageIds: ['m1'] }))?.messages[0].message.contentParts
    ).toEqual(changed.message.contentParts)
  })

  it('rejects an invalid diff without reaching the bridge', async () => {
    const store = new SQLiteSessionRowStore()

    await expect(
      store.applyDiff(
        {
          sessionId: 'session-1',
          threads: { upsert: [], delete: [] },
          messages: { upsert: [messageRow('')], delete: ['m1'] },
        },
        commit(2)
      )
    ).rejects.toMatchObject({ name: 'SessionRowStoreError', operation: 'apply-diff' })

    expect(mockDatabase.executeSet).not.toHaveBeenCalled()
  })

  it('chunks oversized payloads into bounded transactional bridge calls', async () => {
    const store = new SQLiteSessionRowStore()
    const payload = 'x'.repeat(300 * 1024)
    const bigMessage = (messageId: string, seq: number) =>
      messageRow(messageId, {
        seq,
        message: { id: messageId, role: 'user', contentParts: [{ type: 'text', text: payload }] },
      })

    await store.writeRows(
      snapshot({
        sessionId: 'session-1',
        threads: [threadRow('thread-active')],
        messages: [bigMessage('m1', 0), bigMessage('m2', 1), bigMessage('m3', 2)],
      })
    )

    expect(mockDatabase.executeSet.mock.calls.length).toBeGreaterThanOrEqual(4)
    for (const call of mockDatabase.executeSet.mock.calls) {
      expect(call[1]).toBe(true)
      expect(new TextEncoder().encode(JSON.stringify(call[0])).byteLength).toBeLessThanOrEqual(512 * 1024)
    }
    expect(mockDatabase.beginTransaction).not.toHaveBeenCalled()
    expect(mockDatabase.commitTransaction).not.toHaveBeenCalled()
    expect(mockDatabase.rollbackTransaction).not.toHaveBeenCalled()
    const writtenIds = insertedRows('session_messages_staging').map((values) => values[2])
    expect(writtenIds).toEqual(['m1', 'm2', 'm3'])
  })

  it.each([1000, 2000])('keeps serialization work linear for %i staged messages', async (count) => {
    const store = new SQLiteSessionRowStore()
    const encode = TextEncoder.prototype.encode
    let serializedStatementCharacters = 0
    const encoding = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (this: TextEncoder, value) {
      if (value?.includes('"statement":')) serializedStatementCharacters += value.length
      return encode.call(this, value)
    })
    try {
      await store.writeRows(
        snapshot({
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: Array.from({ length: count }, (_, index) => messageRow(`m${index}`, { seq: index })),
        })
      )
    } finally {
      encoding.mockRestore()
    }
    const sentCharacters = mockDatabase.executeSet.mock.calls.reduce(
      (total, call) => total + JSON.stringify(call[0]).length,
      0
    )
    expect(serializedStatementCharacters).toBeLessThan(sentCharacters * 4)
    expect(mockDatabase.executeSet.mock.calls.every((call) => call[1] === true)).toBe(true)
    for (const call of mockDatabase.executeSet.mock.calls) {
      expect(new TextEncoder().encode(JSON.stringify(call[0])).byteLength).toBeLessThanOrEqual(512 * 1024)
    }
  })

  it('serializes replacement messages only as the bridge consumes each bounded batch', async () => {
    const store = new SQLiteSessionRowStore()
    const count = 100
    const contentParts = [{ type: 'text' as const, text: 'x'.repeat(64 * 1024) }]
    let serializedMessages = 0
    const messages = Array.from({ length: count }, (_, index) => {
      const row = messageRow(`m${index}`, { seq: index })
      Object.defineProperty(row.message, 'contentParts', {
        enumerable: true,
        get: () => {
          serializedMessages += 1
          return contentParts
        },
      })
      return row
    })
    let releaseBatch: () => void = () => {}
    const batchPending = new Promise<void>((resolve) => {
      releaseBatch = resolve
    })
    let batchStarted = false
    mockDatabase.executeSet.mockImplementation(async (batch: Array<{ statement: string }>) => {
      if (
        !batchStarted &&
        batch.some((entry) => entry.statement.includes('INSERT OR REPLACE INTO session_messages_staging'))
      ) {
        batchStarted = true
        await batchPending
      }
      return { changes: { changes: 1 } }
    })

    const writing = store.writeRows(
      snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages })
    )
    try {
      await vi.waitFor(() => expect(batchStarted).toBe(true))
      expect(serializedMessages).toBeGreaterThan(0)
      // One native batch plus its lookahead message, not the remaining session.
      expect(serializedMessages).toBeLessThanOrEqual(9)
    } finally {
      releaseBatch()
      await writing
    }
    expect(serializedMessages).toBe(count)
  })

  it('preserves a multi-megabyte unicode payload across code-point-safe chunks', async () => {
    const store = new SQLiteSessionRowStore()
    const payload = `${'中文😀\\'.repeat(256 * 1024)}tail`
    const row = messageRow('huge', {
      message: { id: 'huge', role: 'user', contentParts: [{ type: 'text', text: payload }] },
    })

    await store.writeRows(snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages: [row] }))

    const chunks = insertedRows('session_message_payload_chunks')
      .sort((left, right) => Number(left[2]) - Number(right[2]))
      .map((values) => String(values[3]))
    expect(JSON.parse(chunks.join(''))).toEqual(row.message)
    expect(mockDatabase.executeSet.mock.calls.every((call) => call[1] === true)).toBe(true)
    for (const call of mockDatabase.executeSet.mock.calls) {
      expect(new TextEncoder().encode(JSON.stringify(call[0])).byteLength).toBeLessThanOrEqual(512 * 1024)
    }
  })

  it('leaves current rows untouched when staging an oversized batch fails', async () => {
    const store = new SQLiteSessionRowStore()
    const payload = 'x'.repeat(300 * 1024)
    const bigMessage = (messageId: string, seq: number) =>
      messageRow(messageId, {
        seq,
        message: { id: messageId, role: 'user', contentParts: [{ type: 'text', text: payload }] },
      })
    mockDatabase.executeSet.mockResolvedValueOnce({ changes: { changes: 1 } }).mockRejectedValueOnce(new Error('boom'))

    await expect(
      store.writeRows(
        snapshot({
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [bigMessage('m1', 0), bigMessage('m2', 1), bigMessage('m3', 2)],
        })
      )
    ).rejects.toMatchObject({ name: 'SessionRowStoreError', operation: 'write-rows' })

    expect(mockDatabase.beginTransaction).not.toHaveBeenCalled()
    expect(mockDatabase.commitTransaction).not.toHaveBeenCalled()
    expect(mockDatabase.rollbackTransaction).not.toHaveBeenCalled()
    const attempted = mockDatabase.executeSet.mock.calls.flatMap((_call, index) => statementsOf(index))
    expect(attempted).not.toContain('DELETE FROM session_threads WHERE session_id = ?')
    expect(attempted).not.toContain('DELETE FROM session_messages WHERE session_id = ?')
  })

  it('keeps the old snapshot when the final publish transaction fails', async () => {
    const store = new SQLiteSessionRowStore()
    mockDatabase.executeSet
      .mockResolvedValueOnce({ changes: { changes: 1 } })
      .mockResolvedValueOnce({ changes: { changes: 1 } })
      .mockRejectedValueOnce(new Error('publish failed'))
      .mockResolvedValueOnce({ changes: { changes: 1 } })

    await expect(
      store.writeRows(
        snapshot({
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [messageRow('m1')],
        })
      )
    ).rejects.toMatchObject({ name: 'SessionRowStoreError', operation: 'write-rows' })

    const publish = statementsOf(2)
    expect(publish).toContain('DELETE FROM session_threads WHERE session_id = ?')
    expect(publish).toContain('DELETE FROM session_messages WHERE session_id = ?')
    expect(mockDatabase.executeSet.mock.calls[2][1]).toBe(true)
  })

  it('guards a local diff with its expected revision in the publish transaction', async () => {
    const store = realBridge()
    const initial = projectRowFixture(
      snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages: [] }, 3)
    )
    await store.writeRows(initial)
    mockDatabase.executeSet.mockClear()
    await store.applyDiff(
      { sessionId: 'session-1', threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: [] } },
      { ...initial, revision: 4 },
      3
    )
    const statements = mockDatabase.executeSet.mock.calls.flatMap(
      ([batch]) => batch as Array<{ statement: string; values: unknown[] }>
    )
    expect(statements.find((row) => row.statement.includes('session_row_revision_guard'))?.values).toEqual([
      'session-1',
      3,
    ])
    expect(await store.getRevision('session-1')).toBe(4)
  })

  it('guards a conditional delete and removes every row in one publish transaction', async () => {
    const store = new SQLiteSessionRowStore()

    await store.deleteRows('session-1', 3)

    expect(mockDatabase.executeSet).toHaveBeenCalledTimes(1)
    expect(mockDatabase.executeSet.mock.calls[0][1]).toBe(true)
    expect(statementsOf(0)).toEqual([
      expect.stringContaining('session_row_revision_guard'),
      expect.stringContaining('revision >= ?'),
      expect.stringContaining('UPDATE session_row_heads SET revision = revision + 1'),
      'DELETE FROM session_threads WHERE session_id = ?',
      'DELETE FROM session_messages WHERE session_id = ?',
      expect.stringContaining('DELETE FROM session_text_tokens'),
      expect.stringContaining('DELETE FROM session_message_payload_chunks'),
      expect.stringContaining('INSERT OR REPLACE INTO session_row_delete_receipts'),
    ])
  })

  it('reports a conditional delete conflict when the committed revision advanced', async () => {
    const store = new SQLiteSessionRowStore()
    await store.initialize()
    mockDatabase.query.mockClear()
    mockDatabase.executeSet.mockRejectedValueOnce(new Error('revision guard rejected the delete'))
    mockDatabase.query.mockResolvedValueOnce({ values: [] }).mockResolvedValueOnce({ values: [{ commit_revision: 4 }] })

    await expect(store.deleteRows('session-1', 3)).rejects.toMatchObject({
      name: 'SessionRowConflictError',
      expectedRevision: 3,
      actualRevision: 4,
    })
  })

  it('does not mistake a missing target for an uncertain committed delete', async () => {
    const store = new SQLiteSessionRowStore()
    await store.initialize()
    mockDatabase.query.mockClear()
    mockDatabase.executeSet.mockRejectedValueOnce(new Error('revision guard rejected the delete'))
    mockDatabase.query.mockResolvedValueOnce({ values: [] }).mockResolvedValueOnce({ values: [] })

    await expect(store.deleteRows('missing', 3)).rejects.toMatchObject({
      name: 'SessionRowConflictError',
      expectedRevision: 3,
      actualRevision: null,
    })
  })

  it('accepts an uncertain delete only when its receipt was committed', async () => {
    const store = new SQLiteSessionRowStore()
    await store.initialize()
    mockDatabase.query.mockClear()
    mockDatabase.executeSet.mockRejectedValueOnce(new Error('bridge response was lost'))
    mockDatabase.query.mockImplementationOnce((_sql, params: unknown[]) =>
      Promise.resolve({ values: [{ mutation_id: params[1] }] })
    )

    await expect(store.deleteRows('session-1', 3)).resolves.toBeUndefined()
    expect(mockDatabase.query).toHaveBeenCalledTimes(1)
  })

  it('scans message references by status without selecting the payload column', async () => {
    const store = new SQLiteSessionRowStore()
    await store.initialize()
    mockDatabase.query.mockClear()
    mockDatabase.query.mockResolvedValueOnce({
      values: [{ session_id: 'session-1', thread_id: 'thread-active', message_id: 'm2' }],
    })

    await expect(store.findMessagesByStatus('generating')).resolves.toEqual([
      { sessionId: 'session-1', threadId: 'thread-active', messageId: 'm2' },
    ])

    const [sql, params] = mockDatabase.query.mock.calls[0]
    expect(sql).not.toContain('message_json')
    expect(params).toEqual(['generating'])
  })

  it('maps stored rows back and leaves an absent prompt context snapshot absent', async () => {
    const store = realBridge()
    const initial = projectRowFixture(
      snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages: [messageRow('m1')] })
    )
    await store.writeRows(initial)
    const restored = await store.readSnapshot('session-1')
    expect(restored).toMatchObject(JSON.parse(JSON.stringify(initial)))
    expect(restored?.rows.threads[0]).not.toHaveProperty('sessionPromptContextSnapshot')
  })

  it('reads an empty session back as null', async () => {
    const store = new SQLiteSessionRowStore()
    mockDatabase.query
      .mockResolvedValueOnce({ values: [] })
      .mockResolvedValueOnce({ values: [] })
      .mockResolvedValueOnce({ values: [] })
      .mockResolvedValueOnce({ values: [] })
      .mockResolvedValueOnce({ values: [] })

    await expect(store.readSnapshot('missing')).resolves.toBeNull()
    await expect(store.hasRows('missing')).resolves.toBe(false)
  })
})
