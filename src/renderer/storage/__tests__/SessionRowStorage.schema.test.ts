import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IndexedDBSessionRowStore, SESSION_ROW_DB_NAME } from '../SessionRowStorage'
import { DbSchemaTooNewError, useDbSchemaGuardStore } from '../db-schema-guard'

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
      'messageMutationStage',
      'messages',
      'rowTransferStage',
      'threads',
      'tokenCache',
      'transcriptMessages',
      'transcriptThreads',
    ])
    expect(cursor).not.toHaveBeenCalled()
  } finally {
    db.close()
  }
})

it('preserves newer database contents and reports the schema guard', async () => {
  const db = await open(2, (db) => {
    db.createObjectStore('futureRows').put({ text: 'future complete message' }, 'sentinel')
  })
  db.close()

  await expect(store().initialize()).rejects.toBeInstanceOf(DbSchemaTooNewError)
  expect(useDbSchemaGuardStore.getState().schemaTooNewDbName).toBe(SESSION_ROW_DB_NAME)

  const preserved = await open()
  try {
    expect(preserved.version).toBe(2)
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

it('releases a connection on version change and applies the guard when reopened', async () => {
  const rows = store()
  await rows.initialize()
  const upgraded = await open(2)
  upgraded.close()

  expect(useDbSchemaGuardStore.getState().upgradedElsewhereDbName).toBe(SESSION_ROW_DB_NAME)
  await expect(rows.initialize()).rejects.toBeInstanceOf(DbSchemaTooNewError)
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
