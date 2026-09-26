import 'fake-indexeddb/auto'
import type { SessionMetaRecord } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexedDBSessionMetaStorage } from '../SessionMetaStorage'

function makeRecord(overrides: Partial<SessionMetaRecord> & { id: string }): SessionMetaRecord {
  return {
    name: 'Test Session',
    sortOrder: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  }
}

// Use unique DB names to avoid cross-test interference
let dbCounter = 0

type IndexSet = 'current' | 'legacy'

type IndexedDBSessionMetaStorageInternals = {
  db: IDBDatabase
  openDatabase: () => Promise<void>
}

function createStoreIndexes(store: IDBObjectStore, indexSet: IndexSet) {
  store.createIndex('sortOrder', 'sortOrder', { unique: false })
  store.createIndex('createdAt', 'createdAt', { unique: false })
  if (indexSet === 'current') {
    store.createIndex('starredSortOrder', ['starred', 'sortOrder'], { unique: false })
    store.createIndex('archivedAt', 'archivedAt', { unique: false })
  }
}

function openTestDatabase(dbName: string, options: { version?: number; indexSet?: IndexSet } = {}) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = options.version === undefined ? indexedDB.open(dbName) : indexedDB.open(dbName, options.version)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('records')) {
        const store = db.createObjectStore('records', { keyPath: 'id' })
        createStoreIndexes(store, options.indexSet ?? 'current')
      }
    }
  })
}

// Subclass to inject unique DB names per test
class TestSessionMetaStorage extends IndexedDBSessionMetaStorage {
  constructor(dbName: string, options: { indexSet?: IndexSet } = {}) {
    super()
    // Override the private DB_NAME by re-implementing openDatabase
    ;(this as unknown as IndexedDBSessionMetaStorageInternals).openDatabase = async () => {
      ;(this as unknown as IndexedDBSessionMetaStorageInternals).db = await openTestDatabase(dbName, {
        indexSet: options.indexSet ?? 'current',
      })
    }
  }
}

describe('IndexedDBSessionMetaStorage', () => {
  let storage: IndexedDBSessionMetaStorage

  beforeEach(() => {
    storage = new TestSessionMetaStorage(`test-db-${++dbCounter}`)
  })

  it('create and getById', async () => {
    const record = makeRecord({ id: 'test-1', name: 'Hello' })
    await storage.create(record)
    const result = await storage.getById('test-1')
    expect(result).toEqual(record)
  })

  it('getById returns null for non-existent', async () => {
    await storage.initialize()
    const result = await storage.getById('non-existent')
    expect(result).toBeNull()
  })

  it('creates new databases without upgrading beyond version 1', async () => {
    await storage.initialize()
    expect((storage as unknown as IndexedDBSessionMetaStorageInternals).db.version).toBe(1)
  })

  it('opens already-upgraded databases without requesting a downgrade', async () => {
    const dbName = `test-db-${++dbCounter}`
    const upgradedDb = await openTestDatabase(dbName, { version: 2, indexSet: 'current' })
    upgradedDb.close()

    const upgradedStorage = new TestSessionMetaStorage(dbName)
    await upgradedStorage.initialize()

    expect((upgradedStorage as unknown as IndexedDBSessionMetaStorageInternals).db.version).toBe(2)
  })

  it('does not upgrade legacy version 1 databases during initialization', async () => {
    const dbName = `test-db-${++dbCounter}`
    const legacyDb = await openTestDatabase(dbName, { version: 1, indexSet: 'legacy' })
    legacyDb.close()

    const legacyStorage = new TestSessionMetaStorage(dbName)
    await legacyStorage.initialize()

    const db = (legacyStorage as unknown as IndexedDBSessionMetaStorageInternals).db
    expect(db.version).toBe(1)
    const tx = db.transaction('records', 'readonly')
    const store = tx.objectStore('records')
    expect(store.indexNames.contains('archivedAt')).toBe(false)
  })

  it('round-trips hasPausedToolCall on session meta records', async () => {
    const record = makeRecord({ id: 'paused-1', name: 'Waiting', hasPausedToolCall: true })
    await storage.create(record)

    await expect(storage.getById('paused-1')).resolves.toMatchObject({
      id: 'paused-1',
      hasPausedToolCall: true,
    })
  })

  it('update existing record', async () => {
    const record = makeRecord({ id: 'test-1', name: 'Original' })
    await storage.create(record)

    const updated = await storage.update('test-1', { name: 'Updated' })
    expect(updated?.name).toBe('Updated')
    expect(updated?.id).toBe('test-1')

    const fetched = await storage.getById('test-1')
    expect(fetched?.name).toBe('Updated')
  })

  it('update non-existent returns null', async () => {
    await storage.initialize()
    const result = await storage.update('non-existent', { name: 'nope' })
    expect(result).toBeNull()
  })

  it('delete removes record', async () => {
    const record = makeRecord({ id: 'test-1' })
    await storage.create(record)
    await storage.delete('test-1')
    const result = await storage.getById('test-1')
    expect(result).toBeNull()
  })

  it('deleteMany removes selected records', async () => {
    await storage.createMany([
      makeRecord({ id: 'a', sortOrder: 100 }),
      makeRecord({ id: 'b', sortOrder: 200 }),
      makeRecord({ id: 'c', sortOrder: 300 }),
    ])

    await storage.deleteMany(['a', 'c'])

    expect(await storage.getById('a')).toBeNull()
    expect(await storage.getById('c')).toBeNull()
    expect((await storage.getById('b'))?.id).toBe('b')
    expect(await storage.getTotal()).toBe(1)
  })

  it('getAll sorts starred first, then by sortOrder desc', async () => {
    await storage.create(makeRecord({ id: 'a', sortOrder: 100 }))
    await storage.create(makeRecord({ id: 'b', sortOrder: 300, starred: true }))
    await storage.create(makeRecord({ id: 'c', sortOrder: 200 }))
    await storage.create(makeRecord({ id: 'd', sortOrder: 400, starred: true }))

    const all = await storage.getAll()
    expect(all.map((r) => r.id)).toEqual(['d', 'b', 'c', 'a'])
  })

  it('getAll filters out hidden records', async () => {
    await storage.create(makeRecord({ id: 'visible', sortOrder: 100 }))
    await storage.create(makeRecord({ id: 'hidden', sortOrder: 200, hidden: true }))

    const all = await storage.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('visible')
  })

  it('getArchived returns hidden records sorted by sortOrder desc', async () => {
    await storage.create(makeRecord({ id: 'visible', sortOrder: 300 }))
    await storage.create(makeRecord({ id: 'hidden-system', sortOrder: 400, hidden: true }))
    await storage.create(makeRecord({ id: 'hidden-old', sortOrder: 100, hidden: true, archivedAt: 1000 }))
    await storage.create(makeRecord({ id: 'hidden-new', sortOrder: 200, hidden: true, archivedAt: 2000 }))

    const archived = await storage.getArchived()
    expect(archived.map((record) => record.id)).toEqual(['hidden-new', 'hidden-old'])
  })

  it('getAllIncludingHidden returns visible and hidden records', async () => {
    await storage.create(makeRecord({ id: 'visible', sortOrder: 100 }))
    await storage.create(makeRecord({ id: 'hidden', sortOrder: 200, hidden: true, archivedAt: 1000 }))

    const all = await storage.getAllIncludingHidden()
    expect(all.map((record) => record.id)).toEqual(['hidden', 'visible'])
  })

  it('getArchivedPage returns archived records with cursor pagination', async () => {
    await storage.create(makeRecord({ id: 'visible', sortOrder: 500 }))
    await storage.create(makeRecord({ id: 'archived-1', sortOrder: 100, hidden: true, archivedAt: 1000 }))
    await storage.create(makeRecord({ id: 'archived-2', sortOrder: 200, hidden: true, archivedAt: 2000 }))
    await storage.create(makeRecord({ id: 'archived-3', sortOrder: 300, hidden: true, archivedAt: 3000 }))

    const firstPage = await storage.getArchivedPage(0, 2)
    expect(firstPage.items.map((record) => record.id)).toEqual(['archived-3', 'archived-2'])
    expect(firstPage.nextCursor).toBe(2)
    expect(firstPage.total).toBe(3)

    expect(firstPage.nextCursor).not.toBeNull()
    const secondPage = await storage.getArchivedPage(firstPage.nextCursor ?? 0, 2)
    expect(secondPage.items.map((record) => record.id)).toEqual(['archived-1'])
    expect(secondPage.nextCursor).toBeNull()
    expect(secondPage.total).toBe(3)
  })

  it('getArchivedPage and getArchivedTotal read only the archived index', async () => {
    await storage.createMany([
      ...Array.from({ length: 30 }, (_, i) => makeRecord({ id: `visible-${i}`, sortOrder: i })),
      ...Array.from({ length: 30 }, (_, i) => makeRecord({ id: `hidden-${i}`, sortOrder: 100 + i, hidden: true })),
      ...Array.from({ length: 5 }, (_, i) =>
        makeRecord({ id: `archived-${i}`, sortOrder: 200 + i, hidden: true, archivedAt: 1000 + i })
      ),
    ])
    const storeCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor')
    const storeGetAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')

    const page = await storage.getArchivedPage(2, 2)

    expect(page).toEqual({
      items: [expect.objectContaining({ id: 'archived-2' }), expect.objectContaining({ id: 'archived-1' })],
      nextCursor: 4,
      total: 5,
    })
    expect(await storage.getArchivedPage(5, 2)).toEqual({ items: [], nextCursor: null, total: 5 })
    expect(storeCursor).not.toHaveBeenCalled()
    expect(storeGetAll).not.toHaveBeenCalled()
    storeCursor.mockRestore()
    storeGetAll.mockRestore()
  })

  it('getArchivedPage falls back to sorted scans when archivedAt index is missing', async () => {
    storage = new TestSessionMetaStorage(`test-db-${++dbCounter}`, { indexSet: 'legacy' })
    await storage.create(makeRecord({ id: 'a-new', sortOrder: 100, hidden: true, archivedAt: 3000 }))
    await storage.create(makeRecord({ id: 'm-mid', sortOrder: 200, hidden: true, archivedAt: 2000 }))
    await storage.create(makeRecord({ id: 'z-old', sortOrder: 300, hidden: true, archivedAt: 1000 }))

    const firstPage = await storage.getArchivedPage(0, 2)
    expect(firstPage.items.map((record) => record.id)).toEqual(['a-new', 'm-mid'])
    expect(firstPage.nextCursor).toBe(2)
    expect(firstPage.total).toBe(3)

    const secondPage = await storage.getArchivedPage(firstPage.nextCursor ?? 0, 2)
    expect(secondPage.items.map((record) => record.id)).toEqual(['z-old'])
    expect(secondPage.nextCursor).toBeNull()
  })

  it('createMany batch inserts', async () => {
    const records = [
      makeRecord({ id: 'a', sortOrder: 100 }),
      makeRecord({ id: 'b', sortOrder: 200 }),
      makeRecord({ id: 'c', sortOrder: 300 }),
    ]
    await storage.createMany(records)
    const total = await storage.getTotal()
    expect(total).toBe(3)
  })

  it('createMany with empty array is no-op', async () => {
    await storage.createMany([])
    const total = await storage.getTotal()
    expect(total).toBe(0)
  })

  it('getTotal returns 0 for empty DB', async () => {
    await storage.initialize()
    expect(await storage.getTotal()).toBe(0)
  })

  it('getTotal counts visible records only', async () => {
    await storage.create(makeRecord({ id: 'a', sortOrder: 100 }))
    await storage.create(makeRecord({ id: 'b', sortOrder: 200, hidden: true }))
    expect(await storage.getTotal()).toBe(1)
  })

  it('getAllTotal counts visible and hidden records', async () => {
    await storage.create(makeRecord({ id: 'a', sortOrder: 100 }))
    await storage.create(makeRecord({ id: 'b', sortOrder: 200, hidden: true }))
    expect(await storage.getAllTotal()).toBe(2)
  })

  it('getArchivedTotal counts archived records only', async () => {
    await storage.create(makeRecord({ id: 'a', sortOrder: 100 }))
    await storage.create(makeRecord({ id: 'b', sortOrder: 200, hidden: true }))
    await storage.create(makeRecord({ id: 'c', sortOrder: 300, hidden: true, archivedAt: 1000 }))
    expect(await storage.getArchivedTotal()).toBe(1)
  })

  describe('getPage', () => {
    it('returns first page with correct nextCursor', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.create(makeRecord({ id: `s${i}`, sortOrder: i * 1000 }))
      }
      const page = await storage.getPage(0, 2)
      expect(page.items).toHaveLength(2)
      expect(page.nextCursor).toBe(2)
      expect(page.total).toBe(5)
    })

    it('returns last page with nextCursor null', async () => {
      for (let i = 0; i < 3; i++) {
        await storage.create(makeRecord({ id: `s${i}`, sortOrder: i * 1000 }))
      }
      const page = await storage.getPage(2, 2)
      expect(page.items).toHaveLength(1)
      expect(page.nextCursor).toBeNull()
    })

    it('returns empty page for empty DB', async () => {
      await storage.initialize()
      const page = await storage.getPage(0, 10)
      expect(page.items).toEqual([])
      expect(page.nextCursor).toBeNull()
      expect(page.total).toBe(0)
    })

    it('excludes hidden records from pages', async () => {
      await storage.create(makeRecord({ id: 'visible1', sortOrder: 300 }))
      await storage.create(makeRecord({ id: 'hidden1', sortOrder: 200, hidden: true }))
      await storage.create(makeRecord({ id: 'visible2', sortOrder: 100 }))

      const page = await storage.getPage(0, 10)
      expect(page.items).toHaveLength(2)
      expect(page.items.map((r) => r.id)).toEqual(['visible1', 'visible2'])
      expect(page.total).toBe(2)
    })

    it('respects sorted order (starred first) across pages', async () => {
      await storage.create(makeRecord({ id: 'r1', sortOrder: 300 }))
      await storage.create(makeRecord({ id: 'p1', sortOrder: 100, starred: true }))
      await storage.create(makeRecord({ id: 'r2', sortOrder: 200 }))

      const page1 = await storage.getPage(0, 2)
      const page2 = await storage.getPage(2, 2)
      expect(page1.items.map((r) => r.id)).toEqual(['p1', 'r1'])
      expect(page2.items.map((r) => r.id)).toEqual(['r2'])
      expect(page2.nextCursor).toBeNull()
    })

    it('pages in folder display order when folders exist', async () => {
      await storage.create(makeRecord({ id: 'loose', sortOrder: 500 }))
      await storage.create(makeRecord({ id: 'home', sortOrder: 400, folderId: 'f-home' }))
      await storage.create(makeRecord({ id: 'work', sortOrder: 100, folderId: 'f-work' }))
      await storage.create(makeRecord({ id: 'orphan', sortOrder: 300, folderId: 'deleted' }))
      await storage.create(makeRecord({ id: 'pinned', sortOrder: 50, starred: true, folderId: 'f-home' }))
      await storage.create(makeRecord({ id: 'hidden', sortOrder: 900, hidden: true, folderId: 'f-work' }))

      const folderIds = ['f-work', 'f-home']
      const page1 = await storage.getPage(0, 3, folderIds)
      const page2 = await storage.getPage(3, 3, folderIds)

      expect(page1.items.map((r) => r.id)).toEqual(['pinned', 'work', 'home'])
      expect(page1.nextCursor).toBe(3)
      expect(page2.items.map((r) => r.id)).toEqual(['loose', 'orphan'])
      expect(page2.nextCursor).toBeNull()
      expect(page2.total).toBe(5)
    })

    it('reads the store once for consecutive folder pages', async () => {
      for (const [id, sortOrder] of [
        ['a', 400],
        ['b', 300],
        ['c', 200],
        ['d', 100],
      ] as const) {
        await storage.create(makeRecord({ id, sortOrder, folderId: 'f' }))
      }
      const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')

      await storage.getPage(0, 2, ['f'])
      await storage.getPage(2, 2, ['f'])

      expect(getAll).toHaveBeenCalledTimes(1)
      getAll.mockRestore()
    })

    it('serves pages and the visible count from one read when many sessions are hidden', async () => {
      await storage.createMany([
        makeRecord({ id: 'pinned', sortOrder: 100, starred: true }),
        makeRecord({ id: 'new', sortOrder: 300 }),
        makeRecord({ id: 'old', sortOrder: 200 }),
        ...Array.from({ length: 20 }, (_, i) =>
          makeRecord({ id: `archived-${i}`, sortOrder: 1000 + i, hidden: true, archivedAt: 1000 + i })
        ),
      ])
      const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
      const openCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor')

      const page1 = await storage.getPage(0, 2)
      const page2 = await storage.getPage(2, 2)
      const total = await storage.getTotal()

      expect(page1).toMatchObject({ nextCursor: 2, total: 3 })
      expect([...page1.items, ...page2.items].map((r) => r.id)).toEqual(['pinned', 'new', 'old'])
      expect(page2.nextCursor).toBeNull()
      expect(total).toBe(3)
      expect(getAll).toHaveBeenCalledTimes(1)
      expect(openCursor).not.toHaveBeenCalled()
      getAll.mockRestore()
      openCursor.mockRestore()
    })

    it('keeps the visible count current across writes', async () => {
      await storage.create(makeRecord({ id: 'a', sortOrder: 100 }))
      expect(await storage.getTotal()).toBe(1)

      await storage.create(makeRecord({ id: 'b', sortOrder: 200 }))
      await storage.update('a', { hidden: true, archivedAt: 1000 })
      await storage.createMany([makeRecord({ id: 'c', sortOrder: 300 })])
      expect(await storage.getTotal()).toBe(2)

      await storage.update('a', { hidden: false, archivedAt: undefined })
      await storage.deleteMany(['c'])
      expect(await storage.getTotal()).toBe(2)
      expect((await storage.getPage(0, 10)).items.map((r) => r.id)).toEqual(['b', 'a'])
    })

    it('sorts another folder order from the snapshot without rereading the store', async () => {
      await storage.create(makeRecord({ id: 'loose', sortOrder: 300 }))
      await storage.create(makeRecord({ id: 'filed', sortOrder: 100, folderId: 'f' }))
      const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')

      const folderPage = await storage.getPage(0, 10, ['f'])
      const flatPage = await storage.getPage(0, 10)
      await storage.create(makeRecord({ id: 'new', sortOrder: 400 }))
      const folderPageAgain = await storage.getPage(0, 10, ['f'])
      const flatPageAgain = await storage.getPage(0, 10)

      expect(folderPage.items.map((r) => r.id)).toEqual(['filed', 'loose'])
      expect(flatPage.items.map((r) => r.id)).toEqual(['loose', 'filed'])
      expect(folderPageAgain.items.map((r) => r.id)).toEqual(['filed', 'new', 'loose'])
      expect(flatPageAgain.items.map((r) => r.id)).toEqual(['new', 'loose', 'filed'])
      expect(getAll).toHaveBeenCalledTimes(1)
      getAll.mockRestore()
    })

    it('rereads pages after another tab writes', async () => {
      const dbName = `test-db-${++dbCounter}`
      const tabA = new TestSessionMetaStorage(dbName)
      const tabB = new TestSessionMetaStorage(dbName)
      await tabA.create(makeRecord({ id: 'a', sortOrder: 100 }))
      expect((await tabA.getPage(0, 10)).total).toBe(1)

      await tabB.create(makeRecord({ id: 'b', sortOrder: 200 }))
      await vi.waitFor(async () => expect(await tabA.getTotal()).toBe(2))
      expect((await tabA.getPage(0, 10)).items.map((r) => r.id)).toEqual(['b', 'a'])
    })

    it('does not patch pages for a write whose transaction aborts after the request succeeded', async () => {
      await storage.create(makeRecord({ id: 'a', sortOrder: 100 }))
      await storage.getPage(0, 10)
      const add = IDBObjectStore.prototype.add
      const abortAfterAdd = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore['add']>
      ) {
        const request = add.apply(this, args)
        request.addEventListener('success', () => this.transaction.abort())
        return request
      })

      await expect(storage.create(makeRecord({ id: 'b', sortOrder: 200 }))).rejects.toBeTruthy()
      abortAfterAdd.mockRestore()

      expect(await storage.getById('b')).toBeNull()
      expect((await storage.getPage(0, 10)).items.map((r) => r.id)).toEqual(['a'])
    })

    it('returns records that callers can change without changing later pages', async () => {
      await storage.create(makeRecord({ id: 'a', sortOrder: 100, name: 'Original' }))
      const page = await storage.getPage(0, 10)
      page.items[0].name = 'Changed by caller'
      page.items[0].hidden = true

      const again = await storage.getPage(0, 10)
      expect(again.items.map((r) => [r.id, r.name])).toEqual([['a', 'Original']])
    })

    it('reflects writes and folder order changes in later folder pages', async () => {
      await storage.create(makeRecord({ id: 'a', sortOrder: 300, folderId: 'f1' }))
      await storage.create(makeRecord({ id: 'b', sortOrder: 200, folderId: 'f2' }))
      await storage.getPage(0, 10, ['f1', 'f2'])

      await storage.update('b', { folderId: 'f1' })
      await storage.create(makeRecord({ id: 'c', sortOrder: 100, folderId: 'f2' }))
      expect((await storage.getPage(0, 10, ['f1', 'f2'])).items.map((r) => r.id)).toEqual(['a', 'b', 'c'])
      expect((await storage.getPage(0, 10, ['f2', 'f1'])).items.map((r) => r.id)).toEqual(['c', 'a', 'b'])

      await storage.delete('a')
      expect((await storage.getPage(0, 10, ['f2', 'f1'])).items.map((r) => r.id)).toEqual(['c', 'b'])
    })

    it('patches folder order pages after writes without rereading the store', async () => {
      await storage.create(makeRecord({ id: 'a', sortOrder: 300, folderId: 'f1' }))
      await storage.create(makeRecord({ id: 'b', sortOrder: 200, folderId: 'f2' }))
      await storage.getPage(0, 10, ['f1', 'f2'])
      const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')

      await storage.update('a', { name: 'Renamed' })
      await storage.update('b', { folderId: 'f1' })
      await storage.createMany([makeRecord({ id: 'c', sortOrder: 250, folderId: 'f1' })])
      await storage.update('a', { hidden: true })
      await storage.deleteMany(['missing'])
      const page = await storage.getPage(0, 10, ['f1', 'f2'])

      expect(getAll).not.toHaveBeenCalled()
      expect(page.items.map((r) => r.id)).toEqual(['c', 'b'])
      getAll.mockRestore()

      await storage.clear()
      expect((await storage.getPage(0, 10, ['f1', 'f2'])).items).toEqual([])
    })

    it('rereads folder order pages after a failed write', async () => {
      await storage.create(makeRecord({ id: 'a', sortOrder: 300, folderId: 'f1' }))
      await storage.getPage(0, 10, ['f1'])
      await expect(storage.create(makeRecord({ id: 'a', sortOrder: 100 }))).rejects.toBeTruthy()
      const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')

      expect((await storage.getPage(0, 10, ['f1'])).items.map((r) => r.id)).toEqual(['a'])
      expect(getAll).toHaveBeenCalledTimes(1)
      getAll.mockRestore()
    })

    it('does not keep a folder order read that overlapped a write', async () => {
      await storage.create(makeRecord({ id: 'a', sortOrder: 300, folderId: 'f1' }))
      await storage.create(makeRecord({ id: 'b', sortOrder: 200, folderId: 'f2' }))

      const internals = storage as unknown as { getAllRecords: () => Promise<SessionMetaRecord[]> }
      const readAll = internals.getAllRecords.bind(storage)
      let releaseRead = () => {}
      const readGate = new Promise<void>((resolve) => {
        releaseRead = resolve
      })
      internals.getAllRecords = async () => {
        const records = await readAll()
        await readGate
        return records
      }
      const reading = storage.getPage(0, 10, ['f1', 'f2'])
      await storage.update('b', { folderId: 'f1' })
      releaseRead()
      await reading
      internals.getAllRecords = readAll

      const page = await storage.getPage(0, 10, ['f1', 'f2'])
      expect(page.items.find((r) => r.id === 'b')?.folderId).toBe('f1')
    })
  })

  it('clear removes all records', async () => {
    await storage.create(makeRecord({ id: 'a', sortOrder: 100 }))
    await storage.create(makeRecord({ id: 'b', sortOrder: 200 }))
    expect(await storage.getTotal()).toBe(2)
    await storage.clear()
    expect(await storage.getTotal()).toBe(0)
    expect(await storage.getAllTotal()).toBe(0)
    expect(await storage.getArchivedTotal()).toBe(0)
    expect(await storage.getAll()).toEqual([])
  })
})
