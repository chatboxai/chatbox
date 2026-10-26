import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IndexedDBSessionRowStore, SESSION_ROW_DB_NAME } from '../SessionRowStorage'
import { useDbSchemaGuardStore } from '../db-schema-guard'

const opened: IndexedDBSessionRowStore[] = []

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  useDbSchemaGuardStore.setState({
    schemaTooNewDbName: null,
    upgradedElsewhereDbName: null,
    upgradeBlockedDbName: null,
  })
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

function open(version?: number, upgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SESSION_ROW_DB_NAME, version)
    request.onupgradeneeded = () => upgrade?.(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

it('creates the complete row schema at version 1 with bounded initialization', async () => {
  const cursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor')
  await store().initialize()
  const db = await open()
  try {
    expect(db.version).toBe(1)
    expect(Array.from(db.objectStoreNames)).toEqual([
      'messageTree',
      'messages',
      'rowTransferStage',
      'threads',
      'tokenCache',
      'transcriptThreads',
    ])
    expect(cursor).not.toHaveBeenCalled()
  } finally {
    db.close()
  }
})

it.each([2, 3])('adds missing stores to version %i and preserves unrelated contents', async (version) => {
  const db = await open(version, (db) => {
    db.createObjectStore('futureRows').put({ text: 'future complete message' }, 'sentinel')
  })
  db.close()

  await store().initialize()
  expect(useDbSchemaGuardStore.getState().schemaTooNewDbName).toBeNull()

  const preserved = await open()
  try {
    expect(preserved.version).toBe(version + 1)
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = preserved.transaction('futureRows')
      const read = tx.objectStore('futureRows').get('sentinel')
      tx.oncomplete = () => resolve(read.result)
      tx.onabort = tx.onerror = () => reject(tx.error)
    })
    expect(value).toEqual({ text: 'future complete message' })
  } finally {
    preserved.close()
  }
})

it('releases a connection on version change and reopens at its current version', async () => {
  const rows = store()
  await rows.initialize()
  const upgraded = await open(2)
  upgraded.close()

  expect(useDbSchemaGuardStore.getState().upgradedElsewhereDbName).toBe(SESSION_ROW_DB_NAME)
  await expect(rows.initialize()).resolves.toBeUndefined()
  const db = await open()
  expect(db.version).toBe(2)
  db.close()
})

it('retries initialization after an opening failure', async () => {
  const rows = store()
  const failure = new DOMException('Synthetic transient open failure', 'UnknownError')
  const spy = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
    throw failure
  })
  await expect(rows.initialize()).rejects.toBe(failure)
  spy.mockRestore()
  await expect(rows.initialize()).resolves.toBeUndefined()
  expect(await rows.readCommit('missing')).toBeNull()
})

it('adds a missing index without touching stored messages or unrelated indexes', async () => {
  const rows = store()
  await rows.initialize()
  rows.close()
  const altered = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SESSION_ROW_DB_NAME, 2)
    request.onupgradeneeded = () => {
      const messages = request.transaction!.objectStore('messages')
      messages.deleteIndex('bySession')
      messages.createIndex('futureIndex', 'futureField', { multiEntry: true })
      messages.put({ sessionId: 's', messageId: 'sentinel', body: 'keep' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  altered.close()
  await rows.initialize()
  const db = await open()
  expect(db.version).toBe(3)
  const messages = db.transaction('messages').objectStore('messages')
  expect(messages.indexNames.contains('bySession')).toBe(true)
  expect(messages.index('futureIndex').multiEntry).toBe(true)
  const value = await new Promise<unknown>((resolve) => {
    const read = messages.get(['s', 'sentinel'])
    read.onsuccess = () => resolve(read.result)
  })
  expect(value).toEqual({ sessionId: 's', messageId: 'sentinel', body: 'keep' })
  db.close()
})

it.each(['store', 'keyPath', 'unique', 'multiEntry', 'autoIncrement'])(
  'rejects an incompatible %s shape without upgrading or clearing data',
  async (shape) => {
    const db = await open(3, (db) => {
      const messages = db.createObjectStore('messages', {
        keyPath: shape === 'store' ? ['sessionId', 'wrong'] : ['sessionId', 'messageId'],
        autoIncrement: false,
      })
      if (shape === 'autoIncrement') {
        db.createObjectStore('tokenCache', { keyPath: 'id', autoIncrement: true })
      }
      if (shape !== 'store')
        messages.createIndex('bySession', shape === 'keyPath' ? 'wrong' : 'sessionId', {
          unique: shape === 'unique',
          multiEntry: shape === 'multiEntry',
        })
      messages.put({ sessionId: 's', messageId: 'm', wrong: 'm', body: 'keep' })
    })
    db.close()
    await expect(store().initialize()).rejects.toThrow('Incompatible IndexedDB')
    const preserved = await open()
    expect(preserved.version).toBe(3)
    expect(preserved.objectStoreNames.contains('threads')).toBe(false)
    const count = await new Promise<number>((resolve) => {
      const request = preserved.transaction('messages').objectStore('messages').count()
      request.onsuccess = () => resolve(request.result)
    })
    expect(count).toBe(1)
    preserved.close()
  }
)

it('closes an open that succeeds after close and allows immediate reinitialization', async () => {
  const rows = store()
  const pending = rows.initialize()
  const rejected = expect(pending).rejects.toThrow('canceled')
  rows.close()
  const next = rows.initialize()
  await rejected
  await next
  // An upgrade cannot finish if the canceled open leaked its connection.
  const db = await open(2)
  db.close()
  await rows.initialize()
})

it('retries a concurrent upgrade VersionError before reporting the version wall', async () => {
  const db = await open(3, (db) => db.createObjectStore('futureRows'))
  db.close()
  const original = indexedDB.open.bind(indexedDB)
  let raced = false
  const spy = vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
    if (version !== undefined && !raced) {
      raced = true
      const request = { error: new DOMException('Concurrent upgrade', 'VersionError') } as unknown as IDBOpenDBRequest
      queueMicrotask(() => request.onerror?.(new Event('error')))
      return request
    }
    return version === undefined ? original(name) : original(name, version)
  })
  await store().initialize()
  expect(raced).toBe(true)
  expect(useDbSchemaGuardStore.getState().schemaTooNewDbName).toBeNull()
  spy.mockRestore()
})

it('preserves a tree store whose unique identity index has an incompatible shape', async () => {
  const rows = store()
  await rows.initialize()
  rows.close()
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SESSION_ROW_DB_NAME, 2)
    request.onupgradeneeded = () => {
      const tree = request.transaction!.objectStore('messageTree')
      tree.deleteIndex('byMessage')
      tree.createIndex('byMessage', ['sessionId', 'messageId'], { unique: false })
      tree.put({ sessionId: 's', threadId: 't', messageId: 'keep' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  await expect(rows.initialize()).rejects.toThrow('Incompatible IndexedDB index: messageTree.byMessage')
  const preserved = await open()
  expect(preserved.version).toBe(2)
  const count = await new Promise<number>((resolve) => {
    const read = preserved.transaction('messageTree').objectStore('messageTree').count()
    read.onsuccess = () => resolve(read.result)
  })
  expect(count).toBe(1)
  preserved.close()
})
