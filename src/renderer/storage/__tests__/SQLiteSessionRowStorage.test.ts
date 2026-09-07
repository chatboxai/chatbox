import { CAPACITOR_MESSAGE_ROWS_SCHEMA_SQL } from '@chatbox/core'
import type { SessionRowCommit, SessionRowSnapshot, SessionRows } from '@chatbox/core/ports'
import type { MessageRow, ThreadRow } from '@chatbox/core/session/session-tree'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    expect(mockDatabase.execute).toHaveBeenCalledTimes(1)
    expect(mockDatabase.execute).toHaveBeenCalledWith(CAPACITOR_MESSAGE_ROWS_SCHEMA_SQL)
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

  it('publishes a bounded diff directly in one atomic transaction', async () => {
    const store = new SQLiteSessionRowStore()

    await store.applyDiff(
      {
        sessionId: 'session-1',
        threads: { upsert: [], delete: [] },
        messages: { upsert: [], delete: [] },
      },
      commit(1)
    )
    expect(mockDatabase.executeSet).toHaveBeenCalledOnce()
    vi.clearAllMocks()
    mockDatabase.executeSet.mockResolvedValue({ changes: { changes: 1 } })

    await store.applyDiff(
      {
        sessionId: 'session-1',
        threads: { upsert: [threadRow('thread-active')], delete: [] },
        messages: { upsert: [messageRow('m2', { seq: 1 })], delete: ['m1'] },
      },
      commit(2)
    )

    expect(mockDatabase.executeSet).toHaveBeenCalledTimes(1)
    expect(mockDatabase.executeSet.mock.calls[0][1]).toBe(true)
    expect(statementsOf(0)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('INSERT OR REPLACE INTO session_threads'),
        expect.stringContaining('INSERT OR REPLACE INTO session_messages'),
        'DELETE FROM session_messages WHERE session_id = ? AND message_id = ?',
      ])
    )
    expect(statementsOf(0).some((sql) => sql.includes('session_threads_staging'))).toBe(false)
  })

  it('falls back to staging when a diff cannot fit in one bridge call', async () => {
    const store = new SQLiteSessionRowStore()
    const payload = 'x'.repeat(600 * 1024)

    await store.applyDiff(
      {
        sessionId: 'session-1',
        threads: { upsert: [threadRow('thread-active')], delete: [] },
        messages: {
          upsert: [
            messageRow('m1', {
              message: { id: 'm1', role: 'user', contentParts: [{ type: 'text', text: payload }] },
            }),
          ],
          delete: [],
        },
      },
      commit(2)
    )

    expect(mockDatabase.executeSet.mock.calls.length).toBeGreaterThan(3)
    expect(statementsOf(0)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('INSERT INTO session_threads_staging'),
        expect.stringContaining('INSERT INTO session_messages_staging'),
      ])
    )
    const publish = statementsOf(mockDatabase.executeSet.mock.calls.length - 1)
    expect(publish).toContain('DELETE FROM session_threads WHERE session_id = ?')
    expect(publish).toContain('DELETE FROM session_messages WHERE session_id = ?')
    expect(mockDatabase.executeSet.mock.calls.every((call) => call[1] === true)).toBe(true)
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
    const writtenIds = mockDatabase.executeSet.mock.calls.flatMap((call) =>
      (call[0] as Array<{ values: unknown[] }>)
        .filter((entry) => entry.values.length === 15)
        .map((entry) => entry.values[2])
    )
    expect(writtenIds).toEqual(['m1', 'm2', 'm3'])
  })

  it('preserves a multi-megabyte unicode payload across code-point-safe chunks', async () => {
    const store = new SQLiteSessionRowStore()
    const payload = `${'中文😀\\'.repeat(256 * 1024)}tail`
    const row = messageRow('huge', {
      message: { id: 'huge', role: 'user', contentParts: [{ type: 'text', text: payload }] },
    })

    await store.writeRows(snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages: [row] }))

    const chunks = mockDatabase.executeSet.mock.calls.flatMap((call) =>
      (call[0] as Array<{ statement: string; values: unknown[] }>)
        .filter((entry) => entry.statement.startsWith('INSERT OR REPLACE INTO session_message_payload_chunks'))
        .sort((left, right) => Number(left.values[2]) - Number(right.values[2]))
        .map((entry) => String(entry.values[3]))
    )
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

  it('guards a diff with its expected revision in the publish transaction', async () => {
    const store = new SQLiteSessionRowStore()

    await store.applyDiff(
      {
        sessionId: 'session-1',
        threads: { upsert: [threadRow('thread-active')], delete: [] },
        messages: { upsert: [], delete: [] },
      },
      commit(4),
      3
    )

    expect(statementsOf(0)[0]).toContain('session_row_revision_guard')
    const guard = (mockDatabase.executeSet.mock.calls[0][0] as Array<{ values: unknown[] }>)[0]
    expect(guard.values).toEqual(['session-1', 3])
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
      expect.stringContaining('DELETE FROM session_message_payload_chunks'),
      expect.stringContaining('INSERT OR REPLACE INTO session_row_delete_receipts'),
    ])
  })

  it('reports a conditional delete conflict when the committed revision advanced', async () => {
    const store = new SQLiteSessionRowStore()
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
    mockDatabase.executeSet.mockRejectedValueOnce(new Error('bridge response was lost'))
    mockDatabase.query.mockImplementationOnce((_sql, params: unknown[]) =>
      Promise.resolve({ values: [{ mutation_id: params[1] }] })
    )

    await expect(store.deleteRows('session-1', 3)).resolves.toBeUndefined()
    expect(mockDatabase.query).toHaveBeenCalledTimes(1)
  })

  it('scans message references by status without selecting the payload column', async () => {
    const store = new SQLiteSessionRowStore()
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
    const store = new SQLiteSessionRowStore()
    const record = commit(1).record
    const serializedRecord = JSON.stringify(record)
    mockDatabase.query
      .mockResolvedValueOnce({ values: [{ commit_revision: 1 }] })
      .mockResolvedValueOnce({
        values: [
          {
            session_id: 'session-1',
            thread_id: 'thread-active',
            seq: -1,
            name_length: 13,
            created_at: 1_000,
            root_message_id: 'm1',
            active_leaf_message_id: 'm1',
            compaction_points_json_length: 2,
            session_prompt_context_snapshot_json_length: null,
            session_record_json_length: serializedRecord.length,
            commit_revision: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ values: [{ value: 'thread-active' }] })
      .mockResolvedValueOnce({ values: [{ value: '[]' }] })
      .mockResolvedValueOnce({ values: [{ value: serializedRecord }] })
      .mockResolvedValueOnce({ values: [{ page_count: 1, remaining_count: 1 }] })
      .mockResolvedValueOnce({
        values: [
          {
            session_id: 'session-1',
            message_id: 'm1',
            thread_id: 'thread-active',
            parent_message_id: null,
            active_child_id: null,
            seq: 0,
            kind: 'message',
            status: 'settled',
            created_at: 1_000,
            updated_at: 1_000,
            branch_id: null,
            payload_id: 'payload-m1',
            payload_chunk_count: 1,
            payload_utf8_length: 43,
          },
        ],
      })
      .mockResolvedValueOnce({
        values: [
          {
            payload_id: 'payload-m1',
            chunk_index: 0,
            value: '{"id":"m1","role":"user","contentParts":[]}',
          },
        ],
      })
      .mockResolvedValueOnce({ values: [{ commit_revision: 1 }] })

    const snapshot = await store.readSnapshot('session-1')
    const rows = snapshot?.rows

    expect(snapshot).toMatchObject({ record, revision: 1 })
    expect(rows?.threads[0]).toEqual(threadRow('thread-active', { rootMessageId: 'm1', activeLeafMessageId: 'm1' }))
    expect(rows?.threads[0] && 'sessionPromptContextSnapshot' in rows.threads[0]).toBe(false)
    expect(rows?.messages[0]).toEqual(messageRow('m1'))
  })

  it('reads an empty session back as null', async () => {
    const store = new SQLiteSessionRowStore()
    mockDatabase.query
      .mockResolvedValueOnce({ values: [] })
      .mockResolvedValueOnce({ values: [] })
      .mockResolvedValueOnce({ values: [{ page_count: 1, remaining_count: 0 }] })
      .mockResolvedValueOnce({ values: [] })
      .mockResolvedValueOnce({ values: [] })

    await expect(store.readSnapshot('missing')).resolves.toBeNull()
    await expect(store.hasRows('missing')).resolves.toBe(false)
  })
})
