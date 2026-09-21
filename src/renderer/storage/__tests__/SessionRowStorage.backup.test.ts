import 'fake-indexeddb/auto'
import {
  BackupManifestV3Schema,
  type BackupSessionStore,
  DEFAULT_BACKUP_PAGE_LIMITS,
  exportBackupArchive,
  importBackupArchive,
  prepareBackupExport,
} from '@chatbox/core/backup'
import { backupSessionStorageKey } from '@chatbox/core/backup/storage-keys'
import { SessionRowConflictError } from '@chatbox/core/ports'
import { decodeSessionTree } from '@chatbox/core/session/session-tree'
import type { Session } from '@shared/types'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryMetaStorage, MemoryStorage } from '../../../../packages/chatbox-core/src/backup/sharded.test-support'
import { openNodeSessionRowDatabase } from '../../../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { contextSnapshot } from '../../../../packages/chatbox-core/src/persistence/session-context-read.test-support'
import { SqlSessionRowStore } from '../../../../packages/chatbox-core/src/persistence/session-row-sql'
import { IndexedDBSessionRowStore } from '../SessionRowStorage'

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

async function exportFile(
  source: BackupSessionStore,
  limits = { maxPageRows: 2, maxPageBytes: 4096, maxRecordBytes: 2048 }
) {
  let file = new Blob()
  await exportBackupArchive({
    storage: new MemoryStorage(),
    metaStorage: new MemoryMetaStorage(),
    exportItems: ['conversations'],
    includeKeys: false,
    application: { version: 'test', platform: 'web' },
    sharded: { store: source, limits },
    writeArchive: async (stream) => {
      const parts: Uint8Array<ArrayBuffer>[] = []
      for await (const part of stream()) parts.push(new Uint8Array(part))
      file = new Blob(parts)
      return { boundedMemory: true }
    },
  })
  return file
}

it.each([
  { sourceKind: 'idb', layout: 'single', nativePayloadLimit: 8 * 1024 * 1024 },
  { sourceKind: 'sql', layout: 'single', nativePayloadLimit: 0 },
  { sourceKind: 'idb', layout: 'sharded', nativePayloadLimit: 0 },
  { sourceKind: 'sql', layout: 'sharded', nativePayloadLimit: 8 * 1024 * 1024 },
] as const)(
  'round trips complex work messages from $sourceKind using $layout archives',
  async ({ sourceKind, layout, nativePayloadLimit }) => {
    const database = openNodeSessionRowDatabase()
    const sql = new SqlSessionRowStore(database)
    const idb = new IndexedDBSessionRowStore()
    const [source, target] = sourceKind === 'idb' ? [idb, sql] : [sql, idb]
    const session: Session = {
      id: 'complex-work',
      name: 'Complex work',
      messages: [
        {
          id: 'work',
          role: 'assistant',
          contentParts: [
            ...Array.from({ length: 24 }, (_, index) => ({
              type: 'text' as const,
              text: `Part ${index}: ${'中🙂\\\"\n'.repeat(1000)}`,
            })),
            {
              type: 'tool-call',
              toolName: 'search',
              toolCallId: 'search',
              state: 'result',
              args: { values: Array.from({ length: 9000 }, (_, index) => index) },
              result: { results: Array.from({ length: 9000 }, () => ({ title: 'found', score: 1 })) },
              providerMetadata: { provider: { signature: 's'.repeat(9000), data: [1, 2, 3] } },
              resultStorageKey: 'tool-body',
            },
            {
              type: 'tool-call',
              toolName: 'view_image',
              toolCallId: 'image',
              state: 'result',
              result: { image_storage_key: 'image', media_type: 'image/png' },
            },
            {
              type: 'tool-call',
              toolName: 'create_download',
              toolCallId: 'download',
              state: 'result',
              result: {
                artifacts: [
                  {
                    path: 'artifacts/report.pdf',
                    name: 'report.pdf',
                    mimeType: 'application/pdf',
                    size: 3,
                    storageKey: 'pdf',
                  },
                ],
              },
            },
          ],
          files: [{ id: 'file', name: 'notes.txt', fileType: 'text/plain', storageKey: 'attachment' }],
        },
      ],
    }
    const snapshot = contextSnapshot(session)
    const storage = new MemoryStorage()
    storage.blobs.set('tool-body', 'complete tool result')
    storage.blobs.set('attachment', 'complete attachment')
    storage.blobs.set('image', 'data:image/png;base64,AQID')
    storage.blobs.set('pdf', 'data:application/pdf;base64,AQID')
    const restoredStorage = new MemoryStorage()
    try {
      await source.writeRows(snapshot)
      const exportFrom = async (store: BackupSessionStore, resources: MemoryStorage) => {
        const options = {
          sessionStore: store,
          storage: resources,
          metaStorage: new MemoryMetaStorage(),
          exportItems: ['conversations'] as ['conversations'],
          includeKeys: false,
          application: { version: 'test', platform: 'test' },
          nativePayloadLimit,
        }
        const prepared = await prepareBackupExport(options, {
          singleSessionBytes: layout === 'single' ? 64 * 1024 * 1024 : 64 * 1024,
        })
        expect(prepared.warnings).toEqual([])
        expect(prepared.formatVersion).toBe(layout === 'single' ? 2 : 3)
        let archive = new Blob()
        const result = await exportBackupArchive({
          ...options,
          prepared,
          writeArchive: async (stream) => {
            const parts: Uint8Array<ArrayBuffer>[] = []
            for await (const part of stream()) parts.push(new Uint8Array(part))
            archive = new Blob(parts)
            return { boundedMemory: true }
          },
        })
        expect(result.manifest.resources).toHaveLength(4)
        expect(result.manifest.warnings).toEqual([])
        return archive
      }
      const archive = await exportFrom(source, storage)
      await importBackupArchive(archive, {
        storage: restoredStorage,
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: target, nativePayloadLimit },
      })
      if (layout === 'single') {
        const restored = await restoredStorage.getItem<Session | null>(backupSessionStorageKey(session.id), null)
        if (!restored) throw new Error('Missing restored session')
        await target.writeRows(contextSnapshot(restored))
      }
      expect(await target.readSnapshot(session.id)).not.toBeNull()
      expect((await target.readSnapshot(session.id))?.rows).toEqual(snapshot.rows)
      for (const [key, value] of storage.blobs) expect(restoredStorage.blobs.get(key)).toBe(value)
      const second = await exportFrom(target, restoredStorage)
      await importBackupArchive(second, {
        storage,
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: source, nativePayloadLimit },
      })
      if (layout === 'single') {
        const restored = await storage.getItem<Session | null>(backupSessionStorageKey(session.id), null)
        if (!restored) throw new Error('Missing restored session')
        await source.writeRows(contextSnapshot(restored))
      }
      expect((await source.readSnapshot(session.id))?.rows).toEqual(snapshot.rows)
    } finally {
      database.close()
    }
  }
)

it('batches 64 KiB stored payloads and restores mixed message sizes through SQLite and IndexedDB', async () => {
  const source = new IndexedDBSessionRowStore()
  const database = openNodeSessionRowDatabase()
  const snapshot = contextSnapshot({
    id: 'batch-small-payloads',
    name: 'Batched messages',
    messages: Array.from({ length: 17 }, (_, index) => ({
      id: `message-${String(index).padStart(2, '0')}`,
      role: 'user' as const,
      contentParts: [{ type: 'text' as const, text: 'x'.repeat(index === 8 ? 1024 * 1024 : 64 * 1024) }],
    })),
  })
  try {
    await source.writeRows(snapshot)
    const archive = await exportFile(source, DEFAULT_BACKUP_PAGE_LIMITS)
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()))
    const manifest = BackupManifestV3Schema.parse(JSON.parse(new TextDecoder().decode(entries['manifest.json'])))
    const session = manifest.sessions[0]
    expect(session.payloads).toHaveLength(9)
    expect(session.shards.filter((shard) => shard.kind === 'message').length).toBeLessThan(6)
    const sql = new SqlSessionRowStore(database)
    for (const target of [sql, source]) {
      await importBackupArchive(archive, {
        storage: new MemoryStorage(),
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: target },
      })
      expect((await target.readSnapshot(snapshot.record.id))?.rows).toEqual(snapshot.rows)
    }
    const again = unzipSync(new Uint8Array(await (await exportFile(source, DEFAULT_BACKUP_PAGE_LIMITS)).arrayBuffer()))
    const repeated = BackupManifestV3Schema.parse(JSON.parse(new TextDecoder().decode(again['manifest.json'])))
    expect(repeated.sessions[0].payloads.length).toBe(session.payloads.length)
    expect(repeated.sessions[0].shards.length).toBe(session.shards.length)
  } finally {
    source.close()
    database.close()
  }
})

it('round trips a large IndexedDB message and resumes window reads, edits and reopening', async () => {
  const store = new IndexedDBSessionRowStore()
  const snapshot = contextSnapshot({
    id: 'large-idb',
    name: 'Large',
    messages: [
      {
        id: 'body',
        role: 'assistant',
        contentParts: [{ type: 'text', text: '🙂中\\\"\n'.repeat(80_000) }],
        errorExtra: { nested: ['x'.repeat(200_000), { small: 'kept' }] },
      },
    ],
  })
  await store.writeRows(snapshot)
  const archive = await exportFile(store, DEFAULT_BACKUP_PAGE_LIMITS)
  await importBackupArchive(archive, {
    storage: new MemoryStorage(),
    metaStorage: new MemoryMetaStorage(),
    sharded: { store },
  })
  expect((await store.readSnapshot(snapshot.record.id))?.rows).toEqual(snapshot.rows)
  const window = await store.readMessageWindow({ sessionId: snapshot.record.id, limit: 1 })
  if (!window) throw new Error('Missing large message window')
  expect(window.messages[0].message).toEqual(snapshot.rows.messages[0].message)
  const updated = { ...window.messages[0], message: { ...window.messages[0].message, modelId: 'updated' } }
  await store.applyDiff(
    { sessionId: snapshot.record.id, threads: { upsert: [], delete: [] }, messages: { upsert: [updated], delete: [] } },
    { record: window.record, revision: window.revision + 1 },
    window.revision
  )
  store.close()
  const reopened = new IndexedDBSessionRowStore()
  expect((await reopened.readMessages({ sessionId: snapshot.record.id, messageIds: ['body'] }))?.messages[0]).toEqual(
    updated
  )
  reopened.close()
})

it('upgrades a v1 database additively and exports its existing whole message', async () => {
  const snapshot = contextSnapshot({
    id: 'legacy-large',
    name: 'Legacy',
    messages: [{ id: 'whole', role: 'user', contentParts: [{ type: 'text', text: 'old'.repeat(100_000) }] }],
  })
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('chatbox-messages', 1)
    request.onupgradeneeded = () => {
      const threads = request.result.createObjectStore('threads', { keyPath: ['sessionId', 'threadId'] })
      threads.createIndex('bySession', 'sessionId')
      const messages = request.result.createObjectStore('messages', { keyPath: ['sessionId', 'messageId'] })
      messages.createIndex('bySession', 'sessionId')
      messages.createIndex('byStatus', ['status', 'sessionId', 'threadId', 'messageId'])
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(['threads', 'messages'], 'readwrite')
      for (const thread of snapshot.rows.threads)
        tx.objectStore('threads').put({ ...thread, sessionRecord: snapshot.record, commitRevision: 1 })
      for (const message of snapshot.rows.messages) tx.objectStore('messages').put(message)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
  })
  const store = new IndexedDBSessionRowStore()
  const archive = await exportFile(store, DEFAULT_BACKUP_PAGE_LIMITS)
  await importBackupArchive(archive, {
    storage: new MemoryStorage(),
    metaStorage: new MemoryMetaStorage(),
    sharded: { store },
  })
  expect((await store.readSnapshot(snapshot.record.id))?.rows).toEqual(snapshot.rows)
  store.close()
  await expect(
    new Promise<void>((resolve, reject) => {
      const old = indexedDB.open('chatbox-messages', 1)
      old.onerror = () => reject(old.error)
      old.onsuccess = () => {
        old.result.close()
        resolve()
      }
    })
  ).rejects.toMatchObject({ name: 'VersionError' })
})

it('keeps wide messages readable while allowing only one payload write in flight', async () => {
  const store = new IndexedDBSessionRowStore()
  const snapshot = contextSnapshot({
    id: 'wide',
    name: 'Wide',
    messages: [
      {
        id: 'wide-body',
        role: 'user',
        contentParts: Array.from({ length: 6000 }, () => ({ type: 'text' as const, text: 'x' })),
      },
    ],
  })
  const add = IDBObjectStore.prototype.add
  let active = 0
  let peak = 0
  let chunks = 0
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
    const request = add.call(this, value, key)
    if (this.name === 'payloads') {
      chunks++
      active++
      peak = Math.max(peak, active)
      request.addEventListener('success', () => {
        active--
      })
    }
    return request
  })
  await store.writeRows(snapshot)
  expect(peak).toBe(1)
  expect(chunks).toBeLessThan(4)
  expect((await store.readSnapshot(snapshot.record.id))?.rows).toEqual(snapshot.rows)
})

it('cancels while preparing rollback for a legacy large row and preserves the original session', async () => {
  const store = new IndexedDBSessionRowStore()
  const original = fixture()
  await store.writeRows(original)
  const archive = await exportFile(store)
  original.rows.messages[0].message.contentParts = [{ type: 'text', text: 'old'.repeat(100_000) }]
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('chatbox-messages')
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('messages', 'readwrite')
      tx.objectStore('messages').put(original.rows.messages[0])
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
  const before = await store.readSnapshot(original.record.id)
  const controller = new AbortController()
  const add = IDBObjectStore.prototype.add
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
    const request = add.call(this, value, key)
    if (this.name === 'payloads') controller.abort()
    return request
  })
  await expect(
    importBackupArchive(archive, {
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      signal: controller.signal,
      sharded: { store },
    })
  ).rejects.toThrow()
  expect(controller.signal.aborted).toBe(true)
  expect(await store.readSnapshot(original.record.id)).toEqual(before)
})

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

it('rejects a revision change between backup pages and streams oversized rows as payloads', async () => {
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
  let payloads = 0
  for await (const row of bounded) {
    if (row.kind === 'message' && row.payload?.chunks) {
      payloads++
      for await (const bytes of row.payload.chunks()) expect(bytes.length).toBeLessThanOrEqual(128 * 1024)
    }
  }
  expect(payloads).toBe(1)
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

it('restores a mixed archive single layout message above the IndexedDB inline budget', async () => {
  const database = openNodeSessionRowDatabase()
  const target = new IndexedDBSessionRowStore()
  try {
    const source = new SqlSessionRowStore(database)
    for (const [id, size] of [
      ['small', 200000],
      ['large', 300000],
    ] as const) {
      await source.writeRows(
        contextSnapshot({
          id,
          name: id,
          messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'text', text: 'x'.repeat(size) }] }],
        })
      )
    }
    const options = {
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      sessionStore: source,
      exportItems: ['conversations'] as ['conversations'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
    }
    const prepared = await prepareBackupExport(options, { singleSessionBytes: 250000 })
    expect(prepared.sessions.find((s) => s.id === 'small')?.layout).toBe('single')
    let archive = new Blob()
    await exportBackupArchive({
      ...options,
      prepared,
      writeArchive: async (stream) => {
        const parts: Uint8Array<ArrayBuffer>[] = []
        for await (const part of stream()) parts.push(new Uint8Array(part))
        archive = new Blob(parts)
        return { boundedMemory: true }
      },
    })
    await importBackupArchive(archive, {
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      sharded: { store: target },
    })
    expect(
      (await target.readMessageWindow({ sessionId: 'small', limit: 1 }))?.messages[0].message.contentParts
    ).toEqual([{ type: 'text', text: 'x'.repeat(200000) }])
  } finally {
    database.close()
    target.close()
  }
})

it('publishes medium inline archive messages as payload references and preserves rollback bodies', async () => {
  const store = new IndexedDBSessionRowStore()
  await store.writeRows(fixture())
  const original = await store.readSnapshot('backup/session')
  const draft = await store.beginBackupRestore('backup/session')
  const body = 'x'.repeat(64 * 1024)
  for await (const row of store.iterateBackupRows('backup/session', DEFAULT_BACKUP_PAGE_LIMITS)) {
    await draft.append(
      row.kind === 'message'
        ? {
            ...row,
            message: {
              ...row.message,
              message: { ...row.message.message, contentParts: [{ type: 'text', text: body }] },
            },
          }
        : row
    )
  }
  const put = IDBObjectStore.prototype.put
  let published = 0
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === 'messages') {
      expect(value.message).toBeUndefined()
      expect(value.payload.size).toBeGreaterThan(64 * 1024)
      published++
    }
    return put.call(this, value, key)
  })
  await draft.publish()
  spy.mockRestore()
  expect(published).toBe(original?.rows.messages.length)
  expect((await store.readSnapshot('backup/session'))?.rows.messages[0].message.contentParts).toEqual([
    { type: 'text', text: body },
  ])
  await draft.rollback()
  await draft.dispose()
  expect(await store.readSnapshot('backup/session')).toEqual(original)
  store.close()
})
