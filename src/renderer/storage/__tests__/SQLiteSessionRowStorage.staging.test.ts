import { SessionRowWriteQueue } from '@chatbox/core/application/session'
import { projectRowFixture } from '../../../../packages/chatbox-core/src/ports/testing/session-row-fixtures'
import { stageLegacySessionRows } from '@chatbox/core/backup'
import { RowBackedSessionRepository } from '@chatbox/core/application/session'
import { InMemorySessionRecordStore } from '../../../../packages/chatbox-core/src/testing/InMemorySessionRecordStore'
import type { Message } from '@chatbox/core'
import { DEFAULT_BACKUP_PAGE_LIMITS } from '@chatbox/core/backup'
import { type SessionRowSqlBindValue, type SessionRowSqlDatabase, SqlSessionRowStore } from '@chatbox/core'
import type { SessionRowSnapshot, SessionTextTokenResult } from '@chatbox/core/ports'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type NodeSessionRowSqlDatabase,
  openNodeSessionRowDatabase,
} from '../../../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { SQLiteSessionRowStore } from '../SQLiteSessionRowStorage'

const connection = vi.hoisted(() => ({ createConnection: vi.fn(), closeConnection: vi.fn() }))
vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  // biome-ignore lint/complexity/useArrowFunction: SQLiteConnection is constructed with new.
  SQLiteConnection: vi.fn(function () {
    return connection
  }),
}))

interface NativeStatement {
  statement: string
  values: SessionRowSqlBindValue[]
}
const databases: NodeSessionRowSqlDatabase[] = []
const encoder = new TextEncoder()
const isStaging = (batch: NativeStatement[]) =>
  batch.some((row) => row.statement.startsWith('INSERT OR REPLACE INTO session_messages_staging'))
const isPublish = (batch: NativeStatement[]) =>
  batch.some((row) => row.statement.startsWith('INSERT OR REPLACE INTO session_row_heads'))

function snapshot(count: number, revision = 1): SessionRowSnapshot {
  return projectRowFixture({
    revision,
    record: {
      id: 'session',
      type: 'chat',
      name: `Revision ${revision}`,
      activeThreadId: 'active',
      storageFormat: 'rows',
    },
    rows: {
      sessionId: 'session',
      threads: [
        {
          sessionId: 'session',
          threadId: 'active',
          seq: -1,
          name: 'Active',
          createdAt: 1,
          rootMessageId: 'm0',
          activeLeafMessageId: `m${count - 1}`,
          compactionPoints: [],
        },
      ],
      messages: Array.from({ length: count }, (_, index) => ({
        sessionId: 'session',
        threadId: 'active',
        messageId: `m${index}`,
        parentMessageId: index ? `m${index - 1}` : null,
        activeChildId: index === count - 1 ? null : `m${index + 1}`,
        seq: index,
        kind: 'message',
        status: 'settled',
        createdAt: index,
        updatedAt: index,
        branchId: null,
        message: {
          id: `m${index}`,
          role: 'user',
          contentParts: [{ type: 'text', text: `Revision ${revision} message ${index}` }],
        },
      })),
    },
  })
}

function realBridge(platform: 'ios' | 'android' = 'ios') {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const calls: NativeStatement[][] = []
  const changes: number[] = []
  const hooks: {
    before?: (batch: NativeStatement[]) => void | Promise<void>
    after?: (batch: NativeStatement[]) => void | Promise<void>
    rollback?: (batch: NativeStatement[]) => boolean
  } = {}
  connection.closeConnection.mockResolvedValue(undefined)
  connection.createConnection.mockResolvedValue({
    open: async () => {},
    // Capacitor SQLite iOS removes newlines from execute() batches containing deletes.
    execute: async (sql: string) => {
      if (platform === 'ios') return database.execute(/DELETE FROM/i.test(sql) ? sql.replaceAll('\n', '') : sql)
      for (const statement of sql.split(';\n').filter((part) => part.trim())) await database.query(statement)
    },
    query: async (sql: string, values: SessionRowSqlBindValue[]) => ({ values: await database.query(sql, values) }),
    executeSet: async (batch: NativeStatement[], transaction: boolean) => {
      expect(transaction).toBe(true)
      expect(encoder.encode(JSON.stringify(batch)).byteLength).toBeLessThanOrEqual(480 * 1024)
      expect(batch.every((row) => row.values.length <= 900 && row.values.every((value) => !Array.isArray(value)))).toBe(
        true
      )
      calls.push(batch)
      await hooks.before?.(batch)
      const statements = batch.map((row) => ({ sql: row.statement, params: row.values }))
      if (hooks.rollback?.(batch))
        statements.push({ sql: 'INSERT INTO session_row_revision_guard (value) VALUES (1)', params: [] })
      const before = await database.query<{ count: number }>('SELECT total_changes() AS count')
      await database.executeBatch(statements)
      const after = await database.query<{ count: number }>('SELECT total_changes() AS count')
      changes.push(after[0].count - before[0].count)
      await hooks.after?.(batch)
      return { changes: { changes: 1 } }
    },
  })
  return { database, calls, changes, hooks, store: new SQLiteSessionRowStore() }
}

async function storeRevision(database: NodeSessionRowSqlDatabase): Promise<number | null> {
  const rows = await database.query<{ revision: number }>('SELECT revision FROM session_row_heads')
  return rows[0]?.revision ?? null
}

function expectedSnapshot(value: SessionRowSnapshot | null): SessionRowSnapshot | null {
  if (!value) return null
  return JSON.parse(JSON.stringify(projectRowFixture(structuredClone(value)))) as SessionRowSnapshot
}

async function readContentSnapshot(store: SQLiteSessionRowStore) {
  const snapshot = await store.readSnapshot('session')
  if (!snapshot) return null
  const { textTokens: _textTokens, ...content } = snapshot
  return content
}

async function tokenResults(store: SQLiteSessionRowStore): Promise<SessionTextTokenResult[]> {
  const read = await store.readSnapshot('session')
  return Object.values(read?.textTokens?.sources ?? {}).map((source) => ({
    source,
    value: {
      tokenizerType: 'default',
      sourceDigest: source.textDigest,
      tokens: 7,
      calculatedAt: 100,
    },
  }))
}

function selectedFixture() {
  const old = snapshot(20)
  old.rows.messages[19].message.contentParts = [{ type: 'text', text: 'complete body '.repeat(60_000) }]
  const selected = {
    ...old.rows.messages[19],
    message: {
      ...old.rows.messages[19].message,
      contentParts: [
        ...old.rows.messages[19].message.contentParts,
        { type: 'text' as const, text: 'Updated selected message' },
      ],
    },
  }
  const diff = {
    sessionId: 'session',
    threads: { upsert: [], delete: [] },
    messages: { upsert: [selected], delete: [] },
  }
  const commit = { record: old.record, revision: 2 }
  const next = { ...old, revision: 2, rows: { ...old.rows, messages: [...old.rows.messages.slice(0, -1), selected] } }
  return { old, selected, diff, commit, next }
}

afterEach(() => {
  while (databases.length) databases.pop()?.close()
  vi.unstubAllGlobals()
})

describe('Capacitor staging transport on real SQLite', () => {
  it.each([false, true])(
    'reuses payloads and token results through staged metadata writes (delete=%s)',
    async (removeTail) => {
      const { store, database, calls } = realBridge()
      const old = snapshot(1000)
      await store.writeRows(projectRowFixture(old), null)
      await store.acceptTextTokenResults(await tokenResults(store))
      const before = await database.query<{ message_id: string; payload_id: string }>(
        'SELECT message_id, payload_id FROM session_messages ORDER BY seq'
      )
      const messages = (removeTail ? old.rows.messages.slice(0, -1) : old.rows.messages).map((row) => ({
        ...row,
        seq: row.seq + 10,
        activeChildId: removeTail && row.messageId === 'm998' ? null : row.activeChildId,
      }))
      const threads = removeTail ? [{ ...old.rows.threads[0], activeLeafMessageId: 'm998' }] : old.rows.threads
      calls.length = 0
      await store.applyDiff(
        {
          sessionId: 'session',
          threads: { upsert: removeTail ? threads : [], delete: [] },
          messages: { upsert: [], delete: removeTail ? ['m999'] : [] },
          messageMetadataUpsert: messages.map(({ message: _message, ...row }) => row),
        },
        { record: old.record, revision: 2 },
        1
      )
      expect(calls.some(isStaging)).toBe(true)
      expect(
        calls.flat().some((row) => row.statement.startsWith('INSERT OR REPLACE INTO session_message_payload_chunks'))
      ).toBe(false)
      expect(await database.query('SELECT message_id, payload_id FROM session_messages ORDER BY seq')).toEqual(
        removeTail ? before.slice(0, -1) : before
      )
      const read = await store.readSnapshot('session')
      expect(read?.revision).toBe(2)
      expect(read?.rows.messages.map((row) => [row.messageId, row.seq])).toEqual(
        messages.map((row) => [row.messageId, row.seq])
      )
      expect((await database.query('SELECT * FROM session_text_tokens')).length).toBe(messages.length)
    },
    // Every one of the 1,000 metadata rows is updated, then payload and token preservation are verified.
    30000
  )

  it('initializes a fresh database through iOS delete-batch preprocessing', async () => {
    const { store, database } = realBridge()
    await store.initialize()
    const tables = await database.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'session_messages',
        'session_threads',
        'session_message_payload_chunks',
        'session_text_tokens',
      ])
    )
    await expect(store.readSnapshot('missing')).resolves.toBeNull()
  })

  it('acknowledges numerical batches through the native transaction and retries a lost acknowledgement', async () => {
    const { store, calls, hooks, database } = realBridge()
    await store.writeRows(snapshot(1000), null)
    const results = await tokenResults(store)
    expect(results).toHaveLength(1000)
    calls.length = 0
    expect(await store.acceptTextTokenResults(results)).toHaveLength(1000)
    expect(calls).toHaveLength(1)
    expect(encoder.encode(JSON.stringify({ set: calls[0], transaction: true })).byteLength).toBeLessThan(384 * 1024)
    expect(calls.flat().every((row) => row.statement.includes('INSERT INTO session_text_tokens'))).toBe(true)
    expect(await storeRevision(database)).toBe(1)
    let loseAck = true
    hooks.after = (batch) => {
      if (loseAck && batch.some((row) => row.statement.includes('INSERT INTO session_text_tokens'))) {
        loseAck = false
        throw new Error('lost numerical acknowledgement')
      }
    }
    const updated = [{ ...results[0], value: { ...results[0].value, tokens: 9, calculatedAt: 101 } }]
    await expect(store.acceptTextTokenResults(updated)).rejects.toThrow('lost numerical acknowledgement')
    expect(await store.acceptTextTokenResults(updated)).toMatchObject([{ value: { tokens: 9 } }])
    expect(await database.query('SELECT COUNT(*) AS count FROM session_text_tokens')).toEqual([{ count: 1000 }])
    expect(await storeRevision(database)).toBe(1)
  })

  it('cleans numerical sources only when live staged rows publish and rolls cleanup back on conflict', async () => {
    const { store, hooks, database, calls } = realBridge()
    const { old, diff, commit } = selectedFixture()
    await store.writeRows(projectRowFixture(old), null)
    const results = await tokenResults(store)
    await store.acceptTextTokenResults(results)
    const count = () => database.query('SELECT COUNT(*) AS count FROM session_text_tokens')
    hooks.before = async (batch) => {
      if (isPublish(batch)) expect(await count()).toEqual([{ count: 20 }])
    }
    hooks.rollback = isPublish
    await expect(store.applyDiff(diff, commit, 1)).rejects.toThrow()
    expect(await count()).toEqual([{ count: 20 }])
    expect(await storeRevision(database)).toBe(1)
    hooks.rollback = undefined
    calls.length = 0
    await store.applyDiff(diff, commit, 1)
    expect(await count()).toEqual([{ count: 19 }])
    expect(await store.readTextTokenResults(results.map((result) => result.source))).toHaveLength(19)
    expect(await store.acceptTextTokenResults([results[19]])).toEqual([])
    expect(await storeRevision(database)).toBe(2)
    const stagedRows = calls
      .flat()
      .filter((row) => row.statement.startsWith('INSERT OR REPLACE INTO session_messages_staging'))
    expect(stagedRows).toHaveLength(1)
    const tokenCleanup = calls.flat().filter((row) => row.statement.startsWith('DELETE FROM session_text_tokens'))
    expect(tokenCleanup).toHaveLength(1)
    expect(tokenCleanup[0].values).toEqual([
      'session',
      stagedRows[0].values[0],
      'session',
      stagedRows[0].values[0],
      'session',
    ])
    expect(tokenCleanup[0].statement).toContain(
      'JOIN session_messages m ON m.session_id=s.session_id AND m.message_id=s.message_id'
    )
    const queryPlan = await database.query<{ detail: string }>(
      `EXPLAIN QUERY PLAN ${tokenCleanup[0].statement}`,
      tokenCleanup[0].values
    )
    expect(
      queryPlan.some((row) => /SEARCH session_text_tokens.*session_id=\? AND message_id=\?/.test(row.detail))
    ).toBe(true)
    const payloadCleanup = calls
      .flat()
      .find((row) =>
        row.statement.startsWith('DELETE FROM session_message_payload_chunks WHERE payload_id IN(SELECT m.payload_id')
      )
    expect(payloadCleanup).toBeDefined()
    const payloadPlan = await database.query<{ detail: string }>(
      `EXPLAIN QUERY PLAN ${payloadCleanup!.statement}`,
      payloadCleanup!.values
    )
    expect(payloadPlan.some((row) => /SEARCH m .*session_id=\? AND message_id=\?/.test(row.detail))).toBe(true)
  })

  it.each(['success', 'rollback', 'lost-ack'] as const)(
    'preserves unchanged numerical sources through non-selected structural publish: %s',
    async (outcome) => {
      const { store, hooks, database, calls } = realBridge()
      const { old, selected, commit } = selectedFixture()
      await store.writeRows(projectRowFixture(old), null)
      const results = await tokenResults(store)
      await store.acceptTextTokenResults(results)
      const diff = {
        sessionId: 'session',
        threads: { upsert: [{ ...old.rows.threads[0], name: 'Updated thread' }], delete: [] },
        messages: { upsert: [selected], delete: ['m5'] },
        messageMetadataUpsert: [old.rows.messages[4], old.rows.messages[6]].map(({ message: _body, ...row }) => ({
          ...row,
          ...(row.messageId === 'm4' ? { activeChildId: 'm6' } : { parentMessageId: 'm4' }),
        })),
      }
      const count = () => database.query('SELECT COUNT(*) AS count FROM session_text_tokens')
      calls.length = 0
      hooks.before = async (batch) => {
        if (!isPublish(batch)) return
        expect(await count()).toEqual([{ count: 20 }])
        expect(
          (await database.query<{ message_id: string }>('SELECT message_id FROM session_messages_staging'))
            .map((row) => row.message_id)
            .sort()
        ).toEqual(['m4', ...Array.from({ length: 14 }, (_, index) => `m${index + 6}`)].sort())
      }
      if (outcome === 'rollback') {
        hooks.rollback = isPublish
        await expect(store.applyDiff(diff, commit, 1)).rejects.toThrow()
        expect(await count()).toEqual([{ count: 20 }])
        expect(await storeRevision(database)).toBe(1)
        hooks.rollback = undefined
      }
      if (outcome === 'lost-ack') {
        hooks.after = (batch) => {
          if (isPublish(batch)) throw new Error('lost publish acknowledgement')
        }
      }
      await store.applyDiff(diff, commit, 1)
      expect(await count()).toEqual([{ count: 18 }])
      expect(
        (await store.readTextTokenResults(results.map((result) => result.source)))
          .map((result) => result.source.messageId)
          .sort()
      ).toEqual(
        results
          .filter((result) => !['m5', 'm19'].includes(result.source.messageId))
          .map((result) => result.source.messageId)
          .sort()
      )
      expect(await storeRevision(database)).toBe(2)
      const publish = calls.findLast(isPublish)
      expect(publish).toBeDefined()
      expect(publish?.some((row) => row.statement === 'DELETE FROM session_messages WHERE session_id = ?')).toBe(false)
      const tokenCleanup = publish?.filter((row) => row.statement.startsWith('DELETE FROM session_text_tokens'))
      expect(tokenCleanup).toHaveLength(1)
    }
  )

  it.each(['direct', 'staged'] as const)('cleans deleted message sources in a delete-only %s diff', async (mode) => {
    const { store, database, calls } = realBridge()
    const old = snapshot(10)
    await store.writeRows(projectRowFixture(old), null)
    const results = await tokenResults(store)
    await store.acceptTextTokenResults(results)
    calls.length = 0
    await store.applyDiff(
      {
        sessionId: 'session',
        threads: { upsert: [], delete: [] },
        messages: { upsert: [], delete: ['m5', 'm6'] },
        messageMetadataUpsert: [old.rows.messages[4], old.rows.messages[7]].map(({ message: _body, ...row }) => ({
          ...row,
          ...(row.messageId === 'm4' ? { activeChildId: 'm7' } : { parentMessageId: 'm4' }),
        })),
      },
      { revision: 2, record: { ...old.record, name: mode === 'staged' ? 'thread name '.repeat(50_000) : 'Updated' } },
      1
    )
    expect(await database.query('SELECT COUNT(*) AS count FROM session_text_tokens')).toEqual([{ count: 8 }])
    expect(
      await store.readTextTokenResults(
        results.filter((result) => ['m5', 'm6'].includes(result.source.messageId)).map((result) => result.source)
      )
    ).toEqual([])
    const publish = calls.findLast(isPublish)
    const tokenCleanup = publish?.filter((row) => row.statement.startsWith('DELETE FROM session_text_tokens'))
    expect(tokenCleanup).toHaveLength(1)
    expect(calls.some(isStaging)).toBe(true)
    expect(await storeRevision(database)).toBe(2)
  })

  it.each(['metadata', 'serialization'] as const)(
    'keeps the committed snapshot when replacement %s fails after staging a batch',
    async (failure) => {
      const { store, calls, database } = realBridge()
      const old = snapshot(2)
      await store.writeRows(projectRowFixture(old), null)
      calls.length = 0
      const next = snapshot(100, 2)
      for (const row of next.rows.messages) {
        row.message.contentParts = [{ type: 'text', text: 'x'.repeat(16 * 1024) }]
      }
      const last = next.rows.messages.at(-1)!
      if (failure === 'metadata') last.messageId = ''
      else Object.defineProperty(last.message, 'unsupported', { value: 1n, enumerable: true })

      await expect(store.writeRows(next, 1)).rejects.toMatchObject({
        name: 'SessionRowStoreError',
        operation: 'write-rows',
      })
      if (failure === 'serialization') expect(calls.some(isStaging)).toBe(true)
      expect(calls.some(isPublish)).toBe(false)
      expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(old))
      expect(await storeRevision(database)).toBe(1)
      expect(await database.query('SELECT mutation_id FROM session_row_staging_mutations')).toEqual([])
      expect(await database.query('SELECT message_id FROM session_messages_staging')).toEqual([])
    }
  )

  it.each([1_000, 10_000, 100_000])(
    'stages only selected message metadata in a %i-row conversation',
    async (count) => {
      const { store, calls, changes, hooks, database } = realBridge()
      const old = snapshot(count)
      for (const row of old.rows.messages.slice(-500)) {
        row.message.contentParts = [{ type: 'text', text: 'selected message body '.repeat(60) }]
      }
      await store.writeRows(projectRowFixture(old), null)
      const originalMetadata = await database.query<{ message_id: string; payload_id: string }>(
        'SELECT * FROM session_messages ORDER BY message_id'
      )
      const selected = old.rows.messages.slice(-500).map((row) => ({
        ...row,
        message: {
          ...row.message,
          contentParts: [...row.message.contentParts, { type: 'text' as const, text: ' updated' }],
        },
      }))
      const selectedIds = new Set(selected.map((row) => row.messageId))
      calls.length = 0
      changes.length = 0
      let stagedCount = 0
      hooks.before = async (batch) => {
        if (!isPublish(batch)) return
        const staged = await database.query<{ message_id: string }>('SELECT message_id FROM session_messages_staging')
        stagedCount = staged.length
        expect(staged.map((row) => row.message_id).sort()).toEqual([...selectedIds].sort())
        expect(await database.query('SELECT * FROM session_messages ORDER BY message_id')).toEqual(originalMetadata)
        expect(await storeRevision(database)).toBe(1)
      }
      await store.applyDiff(
        {
          sessionId: 'session',
          threads: { upsert: [], delete: [] },
          messages: { upsert: selected, delete: [] },
        },
        { record: old.record, revision: 2 },
        1
      )
      expect(stagedCount).toBe(selected.length)
      // Count actual SQLite row changes, including payload replacement and cleanup.
      // Each selected row also creates and deletes a payload ownership record.
      // The bound depends on the selected 500 rows, not the conversation size.
      const projectionChanges = selected.length * 2 // Replacement preview and old payload's preview cleanup.
      expect(changes.reduce((sum, value) => sum + value, 0) - projectionChanges).toBeLessThanOrEqual(
        selected.length * 7 + 20
      )
      expect(await database.query('SELECT COUNT(*) AS count FROM session_message_navigation')).toEqual([{ count }])
      expect(calls.flat().some((row) => row.statement === 'DELETE FROM session_messages WHERE session_id = ?')).toBe(
        false
      )
      const nextMetadata = await database.query<{ message_id: string; payload_id: string }>(
        'SELECT * FROM session_messages ORDER BY message_id'
      )
      expect(nextMetadata.filter((row) => !selectedIds.has(row.message_id))).toEqual(
        originalMetadata.filter((row) => !selectedIds.has(row.message_id))
      )
      expect(await readContentSnapshot(store)).toEqual(
        expectedSnapshot({
          ...old,
          revision: 2,
          rows: { ...old.rows, messages: [...old.rows.messages.slice(0, -selected.length), ...selected] },
        })
      )
      expect(await database.query('SELECT mutation_id FROM session_messages_staging')).toEqual([])
    },
    60_000
  )

  it('preserves unselected fork and archived rows and their payload identities', async () => {
    const { store, database } = realBridge()
    const { old, selected, diff, commit } = selectedFixture()
    const fork = {
      ...old.rows.messages[0],
      messageId: 'fork',
      seq: 20,
      parentMessageId: 'm10',
      activeChildId: null,
      branchId: 'fork',
    }
    fork.message = { ...fork.message, id: 'fork' }
    const archived = { ...old.rows.messages[0], messageId: 'archived', threadId: 'zz-archive', activeChildId: null }
    archived.message = { ...archived.message, id: 'archived' }
    old.rows.messages.push(fork, archived)
    old.rows.threads.push({
      ...old.rows.threads[0],
      threadId: 'zz-archive',
      seq: 0,
      name: 'Archived',
      rootMessageId: 'archived',
      activeLeafMessageId: 'archived',
    })
    await store.writeRows(projectRowFixture(old), null)
    const original = await database.query("SELECT * FROM session_messages WHERE message_id IN ('fork', 'archived')")
    await store.applyDiff(diff, commit, 1)
    expect(await database.query("SELECT * FROM session_messages WHERE message_id IN ('fork', 'archived')")).toEqual(
      original
    )
    expect(await readContentSnapshot(store)).toEqual(
      expectedSnapshot({
        ...old,
        revision: 2,
        rows: {
          ...old.rows,
          messages: old.rows.messages.map((row) => (row.messageId === selected.messageId ? selected : row)),
        },
      })
    )
  })

  it.each(['payload', 'staging', 'publish'] as const)(
    'rolls back a selected-message %s failure and retries atomically',
    async (phase) => {
      const { store, hooks, database } = realBridge()
      const { old, diff, commit, next } = selectedFixture()
      await store.writeRows(projectRowFixture(old), null)
      let failed = false
      hooks.rollback = (batch) => {
        const matches =
          phase === 'payload'
            ? batch.some((row) => row.statement.startsWith('INSERT OR REPLACE INTO session_message_payload_chunks'))
            : phase === 'staging'
              ? isStaging(batch)
              : isPublish(batch)
        if (failed || !matches) return false
        failed = true
        return true
      }
      await expect(store.applyDiff(diff, commit, 1)).rejects.toMatchObject({ name: 'SessionRowStoreError' })
      expect(failed).toBe(true)
      expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(old))
      expect(await database.query('SELECT mutation_id FROM session_row_staging_mutations')).toEqual([])
      await store.applyDiff(diff, commit, 1)
      expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(next))
    }
  )

  it.each(['write', 'delete'] as const)(
    'preserves a %s winner against a selected-message CAS conflict',
    async (winnerKind) => {
      const { store, hooks, database } = realBridge()
      const { old, diff, commit } = selectedFixture()
      await store.writeRows(projectRowFixture(old), null)
      const winner = snapshot(21, 3)
      let changed = false
      hooks.after = async (batch) => {
        if (changed || !isStaging(batch)) return
        changed = true
        const other = new SqlSessionRowStore(database)
        if (winnerKind === 'write') await other.writeRows(winner, 1)
        else await other.deleteRows('session', 1)
      }
      await expect(store.applyDiff(diff, commit, 1)).rejects.toMatchObject({
        name: 'SessionRowConflictError',
        expectedRevision: 1,
        actualRevision: winnerKind === 'write' ? 3 : 2,
      })
      expect(changed).toBe(true)
      expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(winnerKind === 'write' ? winner : null))
      expect(await database.query('SELECT mutation_id FROM session_messages_staging')).toEqual([])
    }
  )

  it('recognizes a selected-message publish with a lost bridge acknowledgement', async () => {
    const { store, hooks } = realBridge()
    const { old, diff, commit, next } = selectedFixture()
    await store.writeRows(projectRowFixture(old), null)
    let lost = false
    hooks.after = (batch) => {
      if (!lost && isPublish(batch)) {
        lost = true
        throw new Error('Bridge acknowledgement lost')
      }
    }
    await expect(store.applyDiff(diff, commit, 1)).resolves.toMatchObject({ revision: 2 })
    expect(lost).toBe(true)
    expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(next))
  })

  it('preserves complete escaped multi-chunk bodies and long ids within native budgets', async () => {
    const { store, calls } = realBridge()
    const { old } = selectedFixture()
    const prefix = 'long-\\"\u0001汉😀'.repeat(60)
    const messageId = prefix + 'x'.repeat(1024 - encoder.encode(prefix).byteLength)
    old.rows.messages[18].activeChildId = messageId
    const row = old.rows.messages[19]
    row.messageId = messageId
    row.message = {
      ...row.message,
      id: messageId,
      contentParts: [{ type: 'text', text: '\\"\u0001汉😀'.repeat(100_000) }],
    }
    old.rows.threads[0].activeLeafMessageId = messageId
    await store.writeRows(projectRowFixture(old), null)
    const selected = {
      ...row,
      message: {
        ...row.message,
        contentParts: [...row.message.contentParts, { type: 'text' as const, text: ' updated' }],
      },
    }
    calls.length = 0
    await store.applyDiff(
      { sessionId: 'session', threads: { upsert: [], delete: [] }, messages: { upsert: [selected], delete: [] } },
      { record: old.record, revision: 2 },
      1
    )
    expect(calls.filter(isStaging)).not.toHaveLength(0)
    expect(
      calls.flat().some((statement) => statement.statement === 'DELETE FROM session_messages WHERE session_id = ?')
    ).toBe(false)
    expect(await readContentSnapshot(store)).toEqual(
      expectedSnapshot({
        ...old,
        revision: 2,
        rows: { ...old.rows, messages: [...old.rows.messages.slice(0, -1), selected] },
      })
    )
  })

  it('recovers abandoned sparse staging after cleanup failure without publishing it', async () => {
    const { store, hooks, database } = realBridge()
    const { old, diff, commit, next } = selectedFixture()
    await store.writeRows(projectRowFixture(old), null)
    hooks.after = (batch) => {
      if (isStaging(batch)) throw new Error('Staging acknowledgement lost')
    }
    hooks.before = (batch) => {
      if (batch.some((row) => row.statement === 'DELETE FROM session_row_local_payloads WHERE mutation_id=?'))
        throw new Error('Cleanup unavailable')
    }
    await expect(store.applyDiff(diff, commit, 1)).rejects.toMatchObject({ name: 'SessionRowStoreError' })
    expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(old))
    expect(await database.query('SELECT message_id FROM session_messages_staging')).toEqual([{ message_id: 'm19' }])
    hooks.after = undefined
    hooks.before = undefined
    await new SqlSessionRowStore(database).initialize()
    expect(await database.query('SELECT message_id FROM session_messages_staging')).toEqual([{ message_id: 'm19' }])
    expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(old))
    await database.execute('UPDATE session_row_staging_mutations SET created_at = 0')
    await new SqlSessionRowStore(database).initialize()
    expect(await database.query('SELECT mutation_id FROM session_row_staging_mutations')).toEqual([])
    expect(await database.query('SELECT mutation_id FROM session_messages_staging')).toEqual([])
    expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(old))
    await store.applyDiff(diff, commit, 1)
    expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(next))
  })

  it.each(['thread', 'message-delete', 'thread-delete'] as const)(
    'publishes local rows for a %s diff',
    async (kind) => {
      const { store, hooks } = realBridge()
      const { old, diff, commit, next } = selectedFixture()
      await store.writeRows(projectRowFixture(old), null)
      let published = false
      hooks.before = (batch) => {
        if (!isPublish(batch)) return
        published = true
        expect(batch.some((row) => row.statement === 'DELETE FROM session_messages WHERE session_id = ?')).toBe(false)
      }
      await store.applyDiff(
        {
          ...diff,
          threads: {
            upsert: kind === 'thread' ? old.rows.threads : [],
            delete: kind === 'thread-delete' ? ['missing'] : [],
          },
          messages: { ...diff.messages, delete: kind === 'message-delete' ? ['missing'] : [] },
        },
        commit,
        1
      )
      expect(published).toBe(true)
      expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(next))
    }
  )

  it('rejects local edits without a revision before modifying published rows', async () => {
    const { store } = realBridge()
    const { old, diff, commit } = selectedFixture()
    await store.writeRows(projectRowFixture(old), null)
    await expect(store.applyDiff(diff, commit)).rejects.toMatchObject({
      cause: { message: 'Local row edits require an expected revision' },
    })
    expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(old))
  })

  it('rejects an unknown statement kind without publishing a partial selection', async () => {
    const { store, calls } = realBridge()
    const { old } = selectedFixture()
    await store.writeRows(projectRowFixture(old), null)
    calls.length = 0
    const sqlDatabase = (store as unknown as { store: { database: SessionRowSqlDatabase } }).store.database
    await expect(
      sqlDatabase.executeBatch([{ sql: 'SELECT ?', params: ['x'.repeat(600 * 1024)] }], {
        sessionId: 'session',
        mode: 'replace',
        expectedRevision: 1,
        resultRevision: 2,
      })
    ).rejects.toThrow('session row statement is missing staging metadata')
    expect(calls.some(isPublish)).toBe(false)
    expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(old))
  })

  it.each([1_000, 10_000, 100_000])(
    'coalesces %i rows while preserving the complete snapshot',
    async (count) => {
      const { store, calls, database } = realBridge()
      const expected = snapshot(count)
      await store.writeRows(expected, null)
      expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(expected))
      const insertFamilies = [
        { prefix: 'INSERT OR REPLACE INTO session_messages_staging ', width: 17 },
        { prefix: 'INSERT OR REPLACE INTO session_message_payload_chunks ', width: 4 },
        { prefix: 'INSERT OR REPLACE INTO session_message_navigation ', width: 4 },
      ]
      const isRowInsert = (row: NativeStatement) =>
        insertFamilies.some(({ prefix }) => row.statement.startsWith(prefix))
      const rowBatches = calls.filter((batch) => batch.some(isRowInsert))
      for (const { prefix, width } of insertFamilies) {
        const maxRows = Math.floor(900 / width)
        let totalRows = 0
        for (const batch of rowBatches) {
          const inserts = batch.filter((row) => row.statement.startsWith(prefix))
          const batchRows = inserts.reduce((sum, row) => sum + row.values.length / width, 0)
          totalRows += batchRows
          // Each byte-bounded transport batch may finish with one partial statement per table.
          expect(inserts).toHaveLength(Math.ceil(batchRows / maxRows))
          for (const insert of inserts.slice(0, -1)) expect(insert.values).toHaveLength(maxRows * width)
        }
        expect(totalRows).toBe(count)
      }
      const uncoalescedSizes = rowBatches.map((batch) => {
        let bytes = 2
        let statements = 0
        let largest = 0
        for (const row of batch) {
          const family = insertFamilies.find(({ prefix }) => row.statement.startsWith(prefix))
          const width = family?.width ?? row.values.length
          const statement = family
            ? row.statement.slice(0, row.statement.indexOf(' VALUES ')) +
              ` VALUES (${Array(width).fill('?').join(', ')})`
            : row.statement
          for (let offset = 0; offset < row.values.length; offset += width) {
            const size = encoder.encode(
              JSON.stringify({ statement, values: row.values.slice(offset, offset + width) })
            ).byteLength
            bytes += size + (statements++ ? 1 : 0)
            largest = Math.max(largest, size)
          }
        }
        return { bytes, largest }
      })
      const largestStatement = Math.max(...uncoalescedSizes.map((batch) => batch.largest))
      for (const batch of uncoalescedSizes.slice(0, -1))
        expect(batch.bytes).toBeGreaterThanOrEqual(480 * 1024 - largestStatement - 1)
      // This single-thread fixture has three prepare, four thread and eleven publication statements.
      expect(calls.flat().filter((row) => !isRowInsert(row))).toHaveLength(18)
      expect(
        calls
          .flat()
          .some(
            (row) =>
              row.statement.startsWith('INSERT OR REPLACE INTO session_messages_staging') && row.values.length >= 400
          )
      ).toBe(true)
      expect(await database.query("SELECT name FROM sqlite_master WHERE type = 'trigger'")).toEqual([
        { name: 'session_message_navigation_cleanup' },
        { name: 'session_token_cache_delete' },
        { name: 'session_token_cache_payload' },
      ])
      expect(
        await database.query(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND upper(sql) LIKE '%AFTER INSERT%'"
        )
      ).toEqual([])
      expect(await database.query('PRAGMA foreign_key_list(session_messages_staging)')).toEqual([])
      expect(await database.query('PRAGMA foreign_key_list(session_message_payload_chunks)')).toEqual([])
    },
    60_000
  )

  it('preserves same-key order, escaped values and thread append barriers', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-0000-0000-000000000001' })
    const { store } = realBridge()
    const expected = snapshot(300)
    expected.rows.threads[0].name = 'thread\"\u0001汉😀'.repeat(20_000)
    const old = expected.rows.messages[0]
    const replacement = {
      ...old,
      message: {
        ...old.message,
        contentParts: [{ type: 'text' as const, text: `new '\\\"\u0001汉😀 ${'q'.repeat(2000)}` }],
      },
    }
    expected.rows.messages = [old, ...expected.rows.messages.slice(1), replacement]
    await store.writeRows(projectRowFixture(expected), null)
    expect(await readContentSnapshot(store)).toEqual(
      expectedSnapshot({
        ...expected,
        rows: { ...expected.rows, messages: [replacement, ...expected.rows.messages.slice(1, -1)] },
      })
    )
  })

  // This transaction stages 1,000 bodies and rebuilds the selected-path metadata before snapshot verification.
  it('keeps deletes and commit updates after the staged inserts in a large diff', async () => {
    const { store, calls } = realBridge()
    await store.writeRows(snapshot(1), null)
    calls.length = 0
    const next = snapshot(1_000, 2)
    next.rows.messages[499].activeChildId = 'm501'
    next.rows.messages[501].parentMessageId = 'm499'
    await store.applyDiff(
      {
        sessionId: 'session',
        threads: { upsert: next.rows.threads, delete: [] },
        messages: { upsert: next.rows.messages, delete: ['m500'] },
      },
      { record: next.record, revision: 2 },
      1
    )
    expect(calls.some(isStaging)).toBe(true)
    expect(await readContentSnapshot(store)).toEqual(
      expectedSnapshot({
        ...next,
        rows: { ...next.rows, messages: next.rows.messages.filter((row) => row.messageId !== 'm500') },
      })
    )
  }, 30000)

  it.each(['staging', 'publish'] as const)(
    'rolls back a failed %s transaction and retries from the old snapshot',
    async (phase) => {
      const { store, hooks, database } = realBridge()
      const old = snapshot(1)
      await store.writeRows(projectRowFixture(old), null)
      const next = snapshot(1_000, 2)
      let failed = false
      hooks.rollback = (batch) => {
        if (failed || !(phase === 'staging' ? isStaging(batch) : isPublish(batch))) return false
        failed = true
        return true
      }
      await expect(store.writeRows(next, 1)).rejects.toMatchObject({ name: 'SessionRowStoreError' })
      expect(failed).toBe(true)
      expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(old))
      expect(await database.query('SELECT mutation_id FROM session_row_staging_mutations')).toEqual([])
      await store.writeRows(next, 1)
      expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(next))
      expect(await database.query('SELECT mutation_id FROM session_messages_staging')).toEqual([])
      expect((await database.query('SELECT payload_id FROM session_message_payload_chunks')).length).toBe(1_000)
    }
  )

  it('keeps published rows unchanged until the final CAS transaction', async () => {
    const { store, hooks, database } = realBridge()
    const old = snapshot(1)
    await store.writeRows(projectRowFixture(old), null)
    let stagingBatches = 0
    hooks.after = async (batch) => {
      if (!isStaging(batch)) return
      stagingBatches += 1
      expect(await database.query('SELECT message_id FROM session_messages')).toEqual([{ message_id: 'm0' }])
      expect(await database.query('SELECT revision FROM session_row_heads')).toEqual([{ revision: 1 }])
    }
    await store.writeRows(snapshot(2_000, 2), 1)
    expect(stagingBatches).toBeGreaterThan(1)
    expect((await store.readSnapshot('session'))?.revision).toBe(2)
  })

  it('preserves a concurrent winner when final publication loses its revision CAS', async () => {
    const { store, hooks, database } = realBridge()
    await store.writeRows(snapshot(1), null)
    const winner = snapshot(2, 3)
    let replaced = false
    hooks.after = async (batch) => {
      if (replaced || !isStaging(batch)) return
      replaced = true
      await new SqlSessionRowStore(database).writeRows(winner, 1)
    }
    await expect(store.writeRows(snapshot(1_000, 2), 1)).rejects.toMatchObject({
      name: 'SessionRowConflictError',
      expectedRevision: 1,
      actualRevision: 3,
    })
    expect(replaced).toBe(true)
    expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(winner))
    expect(await database.query('SELECT mutation_id FROM session_messages_staging')).toEqual([])
  })

  it('recognizes a committed publication after its bridge acknowledgement is lost', async () => {
    const { store, hooks } = realBridge()
    await store.writeRows(snapshot(1), null)
    let lost = false
    hooks.after = (batch) => {
      if (!lost && isPublish(batch)) {
        lost = true
        return Promise.reject(new Error('Bridge acknowledgement lost'))
      }
      return Promise.resolve()
    }
    const next = snapshot(1_000, 2)
    await expect(store.writeRows(next, 1)).resolves.toBeUndefined()
    expect(lost).toBe(true)
    expect(await readContentSnapshot(store)).toEqual(expectedSnapshot(next))
  })
})

it('round-trips backup rows through the Capacitor transaction adapter and rolls publication back', async () => {
  const { store } = realBridge()
  const original = snapshot(3)
  original.rows.messages[1].message.contentParts = [{ type: 'text', text: '🙂'.repeat(100_000) }]
  await store.writeRows(original)
  const candidate = await store.beginBackupRestore('session')
  try {
    for await (const row of store.iterateBackupRows('session', DEFAULT_BACKUP_PAGE_LIMITS)) {
      if (row.kind === 'message' && row.payload?.chunks) {
        for await (const chunk of row.payload.chunks()) await candidate.appendPayload!(chunk)
      }
      await candidate.append(row)
    }
    await candidate.publish()
    expect((await store.readSnapshot('session'))?.rows.messages.map((row) => row.message)).toEqual(
      original.rows.messages.map((row) => row.message)
    )
    await candidate.rollback()
    expect((await store.readSnapshot('session'))?.rows.messages.map((row) => row.message)).toEqual(
      original.rows.messages.map((row) => row.message)
    )
  } finally {
    await candidate.dispose()
  }
})

it('initializes all row tables with the Android native statement delimiter', async () => {
  const { store } = realBridge('android')
  expect(await store.listSessionIds()).toEqual([])
  await store.writeRows(snapshot(1))
  expect(await store.listSessionIds()).toEqual(['session'])
})

it.each(['ios', 'android'] as const)(
  'keeps repeated branched append commands bounded through the %s mobile port',
  async (platform) => {
    const { store } = realBridge(platform)
    const repository = new RowBackedSessionRepository({
      rows: store,
      backup: store,
      writes: new SessionRowWriteQueue((_id, action) => action()),
      records: new InMemorySessionRecordStore(),
    })
    await repository.initialize()
    const message = (id: string): Message => ({
      id,
      role: 'user',
      contentParts: [{ type: 'text', text: id }],
      timestamp: 1,
    })
    const seed = await stageLegacySessionRows(store, {
      id: 'session',
      name: 'Forked',
      messages: [message('pivot'), message('tail')],
      messageForksHash: {
        pivot: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'selected', messages: [] },
            { id: 'other', messages: [message('saved')] },
          ],
        },
      },
    })
    await seed.publish()
    await seed.dispose()
    const fullRead = vi.spyOn(store, 'readSnapshot')
    for (const id of ['next', 'last']) {
      const result = await repository.executeSessionCommand('session', { type: 'append', messages: [message(id)] })
      expect(result.kind).toBe('rows')
    }
    expect(fullRead).not.toHaveBeenCalled()
    const persisted = await repository.readSessionTranscriptWindow({ sessionId: 'session', limit: 20 })
    expect(persisted?.messages.map((row) => row.messageId)).toEqual(['pivot', 'tail', 'next', 'last'])
    const inactive = await store.readBranchMessagesPage({ sessionId: 'session', firstMessageId: 'saved', limit: 20 })
    expect(inactive?.messages.map((row) => row.messageId)).toEqual(['saved'])
  }
)

it.each(['ios', 'android'] as const)(
  'commits thread lifecycle through the %s structural mobile port',
  async (platform) => {
    const { store } = realBridge(platform)
    const repository = new RowBackedSessionRepository({
      rows: store,
      backup: store,
      writes: new SessionRowWriteQueue((_id, action) => action()),
      records: new InMemorySessionRecordStore(),
    })
    await repository.initialize()
    const message = (id: string): Message => ({
      id,
      role: 'user',
      contentParts: [{ type: 'text', text: id }],
      timestamp: 1,
    })
    const seed = await stageLegacySessionRows(store, {
      id: 'session',
      name: 'Threaded',
      messages: [message('active')],
      threads: [{ id: 'archived', name: 'History', createdAt: 1, messages: [message('old')] }],
    })
    await seed.publish()
    await seed.dispose()
    const fullRead = vi.spyOn(store, 'readSnapshot')
    const switched = await repository.executeSessionCommand('session', {
      type: 'structure',
      operation: { action: 'thread-switch', threadId: 'archived', archiveId: 'saved', now: 2 },
    })
    expect(switched.kind).toBe('rows')
    const deleted = await repository.executeSessionCommand('session', {
      type: 'structure',
      operation: { action: 'thread-delete', threadId: 'session' },
    })
    expect(deleted.kind).toBe('rows')
    expect(fullRead).not.toHaveBeenCalled()
    const persisted = await repository.readSessionTranscriptWindow({ sessionId: 'session', limit: 20 })
    expect(persisted?.messages.map((row) => row.messageId)).toEqual(['old'])
    expect((await store.readThreadsPage({ sessionId: 'session', limit: 20 }))?.threadIds).toEqual(['archived'])
  }
)
