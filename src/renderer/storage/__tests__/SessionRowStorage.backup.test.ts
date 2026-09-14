import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  exportBackupArchive,
  importBackupArchive,
  DEFAULT_BACKUP_PAGE_LIMITS,
  type BackupSessionStore,
} from '@chatbox/core/backup'
import { contextSnapshot } from '../../../../packages/chatbox-core/src/persistence/session-context-read.test-support'
import { MemoryStorage, MemoryMetaStorage } from '../../../../packages/chatbox-core/src/backup/sharded.test-support'
import { IndexedDBSessionRowStore } from '../SessionRowStorage'
import { decodeSessionTree } from '@chatbox/core/session/session-tree'
import { SessionRowConflictError } from '@chatbox/core/ports'
import { SqlSessionRowStore } from '../../../../packages/chatbox-core/src/persistence/session-row-sql'
import { openNodeSessionRowDatabase } from '../../../../packages/chatbox-core/src/persistence/node-sqlite.test-support'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})
afterEach(() => vi.restoreAllMocks())

const fixture = () =>
  contextSnapshot({
    id: 'backup/session',
    name: 'Backup',
    messages: [
      { id: 'z-first', role: 'user', contentParts: [{ type: 'text', text: 'First' }] },
      { id: 'a-last', role: 'assistant', contentParts: [{ type: 'text', text: 'Last' }] },
    ],
    threads: [
      { id: '\u{10000}', name: 'Older', createdAt: 1, messages: [{ id: 'old-1', role: 'user', contentParts: [] }] },
      { id: '\ue000', name: 'Newer', createdAt: 2, messages: [{ id: 'old-2', role: 'user', contentParts: [] }] },
    ],
    messageForksHash: {
      'z-first': {
        position: 1,
        createdAt: 5,
        lists: [
          { id: 'alternate', messages: [{ id: 'middle-alternative', role: 'assistant', contentParts: [] }] },
          { id: 'selected', messages: [] },
        ],
      },
    },
  })

async function exportFile(source: BackupSessionStore) {
  let file = new Blob()
  await exportBackupArchive({
    storage: new MemoryStorage(),
    metaStorage: new MemoryMetaStorage(),
    exportItems: ['conversations'],
    includeKeys: false,
    application: { version: 'test', platform: 'web' },
    sharded: { store: source, limits: { maxPageRows: 2, maxPageBytes: 4096, maxRecordBytes: 2048 } },
    writeArchive: async (stream) => {
      const parts: Uint8Array<ArrayBuffer>[] = []
      for await (const part of stream()) parts.push(new Uint8Array(part))
      file = new Blob(parts)
      return { boundedMemory: true }
    },
  })
  return file
}

it('round trips full branches through public ZIP backup and resumes ordinary IndexedDB reads and edits', async () => {
  const store = new IndexedDBSessionRowStore()
  const original = fixture()
  await store.writeRows(original)
  const file = await exportFile(store)
  await store.deleteRows(original.record.id)
  await importBackupArchive(file, {
    storage: new MemoryStorage(),
    metaStorage: new MemoryMetaStorage(),
    sharded: { store },
  })
  const restored = await store.readSnapshot(original.record.id)
  if (!restored) throw new Error('Missing restored session')
  const decoded = decodeSessionTree({ session: restored.record, ...restored.rows })
  expect(decoded.ok).toBe(true)
  if (decoded.ok) expect(decoded.session.messages.map((message) => message.id)).toEqual(['z-first', 'a-last'])
  const window = await store.readMessageWindow({ sessionId: original.record.id, limit: 2 })
  expect(window?.messages.map((message) => message.messageId)).toEqual(['z-first', 'a-last'])
  const edited = {
    ...restored.rows.messages.find((message) => message.messageId === 'a-last')!,
    message: { id: 'a-last', role: 'assistant' as const, contentParts: [{ type: 'text' as const, text: 'Edited' }] },
  }
  await store.applyDiff(
    { sessionId: original.record.id, threads: { upsert: [], delete: [] }, messages: { upsert: [edited], delete: [] } },
    { record: restored.record, revision: restored.revision + 1 },
    restored.revision
  )
  const selected = await store.readMessages({ sessionId: original.record.id, messageIds: ['a-last'] })
  expect(selected?.messages[0].message.contentParts).toEqual([{ type: 'text', text: 'Edited' }])
  const rows = []
  for await (const row of store.iterateBackupRows(original.record.id, DEFAULT_BACKUP_PAGE_LIMITS)) rows.push(row)
  expect(rows.filter((row) => row.kind === 'message').map((row) => row.message.messageId)).toEqual([
    'z-first',
    'middle-alternative',
    'a-last',
    'old-2',
    'old-1',
  ])
})

async function candidate(store: IndexedDBSessionRowStore) {
  const rows = []
  for await (const row of store.iterateBackupRows('backup/session', DEFAULT_BACKUP_PAGE_LIMITS)) rows.push(row)
  const draft = await store.beginBackupRestore('backup/session')
  for (const row of rows)
    await draft.append(row.kind === 'header' ? { ...row, record: { ...row.record, name: 'Imported' } } : row)
  return draft
}

it('keeps candidates invisible, preserves another candidate during cleanup, and publishes data that survives reopening', async () => {
  const store = new IndexedDBSessionRowStore()
  await store.writeRows(fixture())
  const original = await store.readSnapshot('backup/session')
  const abandoned = await candidate(store)
  const completed = await candidate(store)
  expect(await store.listSessionIds()).toEqual(['backup/session'])
  expect(await store.readSnapshot('backup/session')).toEqual(original)
  await abandoned.dispose()
  await completed.publish()
  expect((await store.readSnapshot('backup/session'))?.record.name).toBe('Imported')
  await completed.dispose()
  store.close()
  const reopened = new IndexedDBSessionRowStore()
  expect((await reopened.readSnapshot('backup/session'))?.record.name).toBe('Imported')
  reopened.close()
})

it('rolls back a published overwrite and leaves the old body available to a reopened connection', async () => {
  const store = new IndexedDBSessionRowStore()
  await store.writeRows(fixture())
  const original = await store.readSnapshot('backup/session')
  const draft = await candidate(store)
  await draft.publish()
  await draft.rollback()
  await draft.dispose()
  store.close()
  const reopened = new IndexedDBSessionRowStore()
  expect(await reopened.readSnapshot('backup/session')).toEqual(original)
  reopened.close()
})

it('rejects a publication CAS conflict and does not erase the intervening edit', async () => {
  const store = new IndexedDBSessionRowStore()
  const original = fixture()
  await store.writeRows(original)
  const draft = await candidate(store)
  await store.writeRows({ ...original, record: { ...original.record, name: 'Concurrent edit' }, revision: 2 }, 1)
  await expect(draft.publish()).rejects.toBeInstanceOf(SessionRowConflictError)
  await draft.dispose()
  expect((await store.readSnapshot(original.record.id))?.record.name).toBe('Concurrent edit')
})

it('aborts the entire publish transaction on a row failure and only cleans its candidate', async () => {
  const store = new IndexedDBSessionRowStore()
  await store.writeRows(fixture())
  const original = await store.readSnapshot('backup/session')
  const draft = await candidate(store)
  const put = IDBObjectStore.prototype.put
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value,
    key
  ) {
    if (this.name === 'messages' && value.messageId === 'a-last') throw new Error('Injected publish failure')
    return put.call(this, value, key)
  })
  await expect(draft.publish()).rejects.toThrow('Injected publish failure')
  fault.mockRestore()
  await draft.dispose()
  expect(await store.readSnapshot('backup/session')).toEqual(original)
})

it('cleans partial candidates on cancellation through the public importer', async () => {
  const store = new IndexedDBSessionRowStore()
  await store.writeRows(fixture())
  const file = await exportFile(store)
  const original = await store.readSnapshot('backup/session')
  const controller = new AbortController()
  vi.spyOn(store, 'beginBackupRestore').mockImplementation(async (id) => {
    const draft = await IndexedDBSessionRowStore.prototype.beginBackupRestore.call(store, id)
    let count = 0
    return {
      ...draft,
      append: async (row) => {
        await draft.append(row)
        if (++count === 3) controller.abort()
      },
    }
  })
  await expect(
    importBackupArchive(file, {
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      sharded: { store },
      signal: controller.signal,
    })
  ).rejects.toThrow()
  expect(await store.readSnapshot('backup/session')).toEqual(original)
  expect(await store.listSessionIds()).toEqual(['backup/session'])
})

it('keeps the original and another candidate when a structured-clone batch fails', async () => {
  const store = new IndexedDBSessionRowStore()
  await store.writeRows(fixture())
  const original = await store.readSnapshot('backup/session')
  const retained = await candidate(store)
  const broken = await store.beginBackupRestore('backup/session')
  await broken.append({ kind: 'header', record: fixture().record })
  const row = fixture().rows.messages[0]
  const invalid = Object.assign({}, row, { unserializable: () => {} })
  await expect(broken.append({ kind: 'message', message: invalid })).rejects.toThrow()
  await broken.dispose()
  expect(await store.readSnapshot('backup/session')).toEqual(original)
  await retained.publish()
  await retained.dispose()
  expect((await store.readSnapshot('backup/session'))?.record.name).toBe('Imported')
})

it('rejects a revision change between backup pages and enforces the row byte budget', async () => {
  const store = new IndexedDBSessionRowStore()
  const original = fixture()
  await store.writeRows(original)
  const rows = store.iterateBackupRows(original.record.id, { ...DEFAULT_BACKUP_PAGE_LIMITS, maxPageRows: 1 })
  await rows.next()
  await store.writeRows({ ...original, revision: 2 }, 1)
  await expect(rows.next()).rejects.toBeInstanceOf(SessionRowConflictError)
  const oversized = fixture()
  oversized.rows.messages[0].message.contentParts = [{ type: 'text', text: 'x'.repeat(4096) }]
  await store.writeRows({ ...oversized, revision: 3 }, 2)
  const bounded = store.iterateBackupRows(original.record.id, {
    maxPageRows: 2,
    maxPageBytes: 4096,
    maxRecordBytes: 2048,
  })
  await expect(bounded.next()).rejects.toThrow('Backup record requires payload blocks')
})

it.each(['sql-to-indexeddb', 'indexeddb-to-sql'] as const)(
  'uses the shared logical archive for %s restoration',
  async (direction) => {
    const database = openNodeSessionRowDatabase()
    try {
      const sql = new SqlSessionRowStore(database)
      const idb = new IndexedDBSessionRowStore()
      const source = direction === 'sql-to-indexeddb' ? sql : idb
      const target = direction === 'sql-to-indexeddb' ? idb : sql
      await source.writeRows(fixture())
      await importBackupArchive(await exportFile(source), {
        storage: new MemoryStorage(),
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: target },
      })
      const restored = await target.readSnapshot('backup/session')
      if (!restored) throw new Error('Missing restored session')
      const decoded = decodeSessionTree({ session: restored.record, ...restored.rows })
      expect(decoded.ok).toBe(true)
      if (decoded.ok) {
        expect(decoded.session.messages.map((message) => message.id)).toEqual(['z-first', 'a-last'])
        expect(decoded.session.messageForksHash?.['z-first'].position).toBe(1)
        expect(decoded.session.threads?.map((thread) => thread.id)).toEqual(['\u{10000}', '\ue000'])
      }
      idb.close()
    } finally {
      database.close()
    }
  }
)
