import 'fake-indexeddb/auto'
import { SessionRowConflictError, type SessionRowSnapshot } from '@chatbox/core/ports'
import { prepareSessionRowsFixture } from '@chatbox/core/ports/testing/session-row-fixtures'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IndexedDBSessionRowStore } from '../SessionRowStorage'
import { SESSION_ROW_DB_NAME, SESSION_ROW_MESSAGE_STORE } from '../session-row-idb-records'

const opened: IndexedDBSessionRowStore[] = []
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const store of opened.splice(0)) store.close()
})

function store() {
  const value = new IndexedDBSessionRowStore()
  opened.push(value)
  return value
}

function fixture(text = '中文🦋'.repeat(80_000)): SessionRowSnapshot {
  const tree = prepareSessionRowsFixture({
    id: 'whole-message',
    name: 'Synthetic complete message fixture',
    type: 'chat',
    messages: [
      { id: 'a', role: 'user', contentParts: [{ type: 'text', text }] },
      { id: 'b', role: 'assistant', contentParts: [{ type: 'text', text: 'second' }] },
    ],
  })
  return {
    record: tree.session,
    revision: 1,
    rows: { sessionId: tree.session.id, threads: tree.threads, messages: tree.messages },
  }
}

async function rawRead<Value>(name: string, read: (store: IDBObjectStore) => IDBRequest<Value>): Promise<Value> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SESSION_ROW_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise<Value>((resolve, reject) => {
      const tx = db.transaction(name, 'readonly')
      const request = read(tx.objectStore(name))
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

it('writes and iterates complete oversized messages with no persistent message fragments', async () => {
  const rows = store()
  const source = fixture()
  await rows.writeRows(source)
  const persisted = await rawRead(SESSION_ROW_MESSAGE_STORE, (table) => table.get([source.record.id, 'a']))
  expect(persisted.message).toEqual(source.rows.messages[0].message)
  expect(persisted).not.toHaveProperty('payload')
  const exported = []
  for await (const row of rows.iterateRows({ sessionId: source.record.id, expectedRevision: 1 })) exported.push(row)
  expect(exported.filter((row) => row.kind === 'message')).toHaveLength(2)
})

it('publishes invisible complete-row candidates atomically and rejects a stale revision', async () => {
  const rows = store()
  const source = fixture('candidate')
  const candidate = await rows.stageRows({ record: source.record, revision: 1 }, null)
  for (const thread of source.rows.threads) await candidate.appendThread(thread)
  for (const message of source.rows.messages) await candidate.appendMessage(message)
  expect(await rows.readCommit(source.record.id)).toBeNull()
  await candidate.publish()
  await candidate.dispose()
  expect((await rows.readMessages({ sessionId: source.record.id, messageIds: ['a', 'b'] }))?.messages).toEqual(
    source.rows.messages
  )
  const stale = await rows.stageRows({ record: source.record, revision: 2 }, 1)
  await rows.writeRows({ ...source, revision: 2 }, 1)
  await expect(stale.publish()).rejects.toBeInstanceOf(SessionRowConflictError)
  await stale.dispose()
  expect((await rows.readCommit(source.record.id))?.revision).toBe(2)
})

it('detects source changes between complete-row iteration steps and preserves live rows on candidate failure', async () => {
  const rows = store()
  const source = fixture('revision')
  await rows.writeRows(source)
  const iterator = rows.iterateRows({ sessionId: source.record.id })[Symbol.asyncIterator]()
  await iterator.next()
  await rows.writeRows({ ...source, revision: 2 }, 1)
  await expect(iterator.next()).rejects.toBeInstanceOf(SessionRowConflictError)
  const invalid = await rows.stageRows({ record: source.record, revision: 3 }, 2)
  for (const thread of source.rows.threads) await invalid.appendThread(thread)
  await expect(invalid.publish()).rejects.toThrow()
  await invalid.dispose()
  expect((await rows.readCommit(source.record.id))?.revision).toBe(2)
})

it('rejects candidate commits that do not declare the current row format', async () => {
  const rows = store()
  const source = fixture('format boundary')
  await expect(
    rows.stageRows({ record: { ...source.record, rowFormatVersion: undefined }, revision: 1 }, null)
  ).rejects.toThrow('Row candidate commit is invalid')
  expect(await rows.readCommit(source.record.id)).toBeNull()
})

it.each(['missing', 'stale'] as const)(
  'rebuilds facts and selected paths when staged projections are %s',
  async (mode) => {
    const rows = store()
    const source = fixture('derived projections')
    const inactive = {
      ...source.rows.messages[1],
      messageId: 'inactive',
      seq: source.rows.messages[1].seq + 1,
      branchId: 'inactive-branch',
      message: { ...source.rows.messages[1].message, id: 'inactive' },
    }
    const input = [...source.rows.messages, inactive]
    const candidate = await rows.stageRows({ record: source.record, revision: 1 }, null)
    for (const thread of source.rows.threads) await candidate.appendThread(thread)
    for (const row of input)
      await candidate.appendMessage({
        ...row,
        facts: { ...row.facts!, role: 'system' },
        selected: mode === 'missing' ? undefined : row.messageId === 'inactive',
      })
    await candidate.publish()
    await candidate.dispose()
    const stored = await rows.readMessages({ sessionId: source.record.id, messageIds: ['a', 'b', 'inactive'] })
    expect(stored?.messages.map((row) => [row.messageId, row.facts?.role, row.selected])).toEqual([
      ['a', 'user', true],
      ['b', 'assistant', true],
      ['inactive', 'assistant', false],
    ])
    const projections = await rawRead('transcriptMessages', (table) =>
      table.getAll(IDBKeyRange.bound([source.record.id], [source.record.id, []]))
    )
    expect(projections.map((row) => [row.messageId, row.selectedDepth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['inactive', null],
    ])
  }
)

it('captures commit and queued append values before the caller can mutate their objects', async () => {
  const rows = store()
  const source = fixture('captured candidate')
  const expected = structuredClone(source)
  const commit = { record: source.record, revision: 1 }
  const preparing = rows.stageRows(commit, null)
  commit.record.name = 'caller mutation'
  commit.record.activeThreadId = 'caller-thread'
  commit.revision = 99
  const candidate = await preparing
  const writes: Promise<void>[] = []
  for (const thread of source.rows.threads) {
    writes.push(candidate.appendThread(thread))
    thread.rootMessageId = 'caller-root'
  }
  for (const row of source.rows.messages) {
    writes.push(candidate.appendMessage(row))
    row.parentMessageId = 'caller-parent'
    row.message.contentParts = [{ type: 'text', text: 'caller body' }]
  }
  await Promise.all(writes)
  await candidate.publish()
  await candidate.dispose()
  expect(await rows.readCommit(expected.record.id)).toEqual({ record: expected.record, revision: 1 })
  expect((await rows.readMessages({ sessionId: expected.record.id, messageIds: ['a', 'b'] }))?.messages).toEqual(
    expected.rows.messages
  )
})
