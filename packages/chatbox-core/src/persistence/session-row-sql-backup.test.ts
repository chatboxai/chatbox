import { afterEach, expect, it, vi } from 'vitest'
import { SessionRowConflictError } from '../ports/session-row-store'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { contextSnapshot } from './session-context-read.test-support'
import { type SessionRowSqlStatement, SqlSessionRowStore } from './session-row-sql'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const db of databases.splice(0)) db.close()
})
async function fixture(count: number, text = 'message') {
  const db = openNodeSessionRowDatabase()
  databases.push(db)
  const store = new SqlSessionRowStore(db)
  const old = contextSnapshot({ id: 'backup', name: 'Old', messages: [] })
  await store.writeRows(old)
  const snapshot = contextSnapshot({
    id: 'backup',
    name: 'New',
    messages: Array.from({ length: count }, (_, i) => ({
      id: `m${i}`,
      role: 'user',
      contentParts: [{ type: 'text', text }],
    })),
  })
  const candidate = await store.beginBackupRestore('backup')
  await candidate.append({ kind: 'header', record: snapshot.record })
  for (const thread of snapshot.rows.threads) await candidate.append({ kind: 'thread', thread })
  return { db, store, old, snapshot, candidate }
}

it.each([
  ['small', 500, 'x'.repeat(1024)],
  ['escaped', 60, '\u0001\\中🙂'.repeat(2000)],
] as const)(
  'batches %s messages within count and encoded-byte budgets, then publishes atomically',
  async (_, count, text) => {
    const { db, store, old, snapshot, candidate } = await fixture(count, text)
    const execute = db.executeBatch.bind(db)
    const batches: SessionRowSqlStatement[][] = []
    vi.spyOn(db, 'executeBatch').mockImplementation(async (statements, options) => {
      const batch = [...statements]
      batches.push(batch)
      return execute(batch, options)
    })
    for (const message of snapshot.rows.messages) await candidate.append({ kind: 'message', message })
    expect((await store.readSnapshot('backup'))?.rows).toEqual(old.rows)
    await candidate.publish()
    const staging = batches.slice(0, -1)
    expect(staging.length).toBeLessThan(count / 2)
    for (const batch of staging) {
      expect(batch.length).toBeLessThanOrEqual(128)
      const bytes = new TextEncoder().encode(JSON.stringify(batch.map((s) => ({ statement: s.sql, values: s.params }))))
      expect(bytes.length).toBeLessThanOrEqual(384 * 1024)
    }
    expect((await store.readSnapshot('backup'))?.rows).toEqual(snapshot.rows)
    await candidate.rollback()
    await candidate.dispose()
    expect((await store.readSnapshot('backup'))?.rows).toEqual(old.rows)
  }
)

it('discards unflushed messages on cancellation instead of writing them during cleanup', async () => {
  const { db, store, old, snapshot, candidate } = await fixture(3)
  const writes = vi.spyOn(db, 'executeBatch')
  for (const message of snapshot.rows.messages) await candidate.append({ kind: 'message', message })
  expect(writes).not.toHaveBeenCalled()
  await candidate.rollback()
  await candidate.dispose()
  expect((await store.readSnapshot('backup'))?.rows).toEqual(old.rows)
  expect(await db.query('SELECT * FROM session_messages_staging')).toEqual([])
  expect(await db.query('SELECT * FROM session_message_payload_chunks')).toEqual([])
  expect(await db.query('SELECT * FROM session_row_staging_mutations')).toEqual([])
})

it('cannot publish a candidate after a buffered write failed, and cleans previously flushed staging', async () => {
  const { db, store, old, snapshot, candidate } = await fixture(200)
  const execute = db.executeBatch.bind(db)
  const error = new Error('staging write failed')
  let calls = 0
  vi.spyOn(db, 'executeBatch').mockImplementation(async (statements, options) => {
    if (++calls === 2) throw error
    return execute(statements, options)
  })
  await expect(
    (async () => {
      for (const message of snapshot.rows.messages) await candidate.append({ kind: 'message', message })
    })()
  ).rejects.toBe(error)
  await expect(candidate.publish()).rejects.toBe(error)
  await candidate.rollback()
  await candidate.dispose()
  expect((await store.readSnapshot('backup'))?.rows).toEqual(old.rows)
  expect(await db.query('SELECT * FROM session_messages_staging')).toEqual([])
  expect(await db.query('SELECT * FROM session_message_payload_chunks')).toEqual([])
})

it('preserves a concurrent writer when the final buffered batch is flushed before publication', async () => {
  const { db, store, snapshot, candidate } = await fixture(3)
  for (const message of snapshot.rows.messages) await candidate.append({ kind: 'message', message })
  const concurrent = contextSnapshot({ id: 'backup', name: 'Concurrent', messages: [] }, 2)
  await store.writeRows(concurrent)
  await expect(candidate.publish()).rejects.toBeInstanceOf(SessionRowConflictError)
  await candidate.dispose()
  expect((await store.readSnapshot('backup'))?.record.name).toBe('Concurrent')
  expect(await db.query('SELECT * FROM session_messages_staging')).toEqual([])
})

it('does not publish if cancelled while the final staging flush is in flight', async () => {
  const { db, store, old, snapshot, candidate } = await fixture(3)
  for (const message of snapshot.rows.messages) await candidate.append({ kind: 'message', message })
  const controller = new AbortController()
  const execute = db.executeBatch.bind(db)
  vi.spyOn(db, 'executeBatch').mockImplementationOnce(async (statements, options) => {
    await execute(statements, options)
    controller.abort(new Error('cancel during staging'))
  })
  await expect(candidate.publish(controller.signal)).rejects.toThrow('cancel during staging')
  await candidate.dispose()
  expect((await store.readSnapshot('backup'))?.rows).toEqual(old.rows)
  expect(await db.query('SELECT * FROM session_messages_staging')).toEqual([])
})
