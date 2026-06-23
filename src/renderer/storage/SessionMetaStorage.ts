import type { SessionMetaPage, SessionMetaRecord } from '@shared/types'

const DB_NAME = 'chatbox-session-meta'
const STORE_NAME = 'records'
const DEFAULT_PAGE_SIZE = 50
const DB_VERSION = 2
const GROUP_INDEX = 'byGroup'

// Records carry an internal `groupKey` (= groupId ?? '') so a [groupKey, sortOrder] compound index
// can range-query by group. IndexedDB skips records whose indexed key path is `undefined`, so a raw
// `groupId` index would lose all ungrouped sessions — the '' sentinel keeps them queryable.
const UNGROUPED_KEY = ''
type StoredMetaRecord = SessionMetaRecord & { groupKey: string }

function toStored(record: SessionMetaRecord): StoredMetaRecord {
  return { ...record, groupKey: record.groupId ?? UNGROUPED_KEY }
}

/** Drop the internal `groupKey` index field so callers only ever see a clean SessionMetaRecord. */
function fromStored(record: SessionMetaRecord & { groupKey?: string }): SessionMetaRecord {
  const { groupKey: _groupKey, ...rest } = record
  return rest
}

export interface SessionMetaStorage {
  initialize(): Promise<void>
  create(record: SessionMetaRecord): Promise<void>
  createMany(records: SessionMetaRecord[]): Promise<void>
  update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null>
  getById(id: string): Promise<SessionMetaRecord | null>
  delete(id: string): Promise<void>
  deleteMany(ids: string[]): Promise<void>
  getAll(): Promise<SessionMetaRecord[]>
  getPage(cursor: number, limit?: number): Promise<SessionMetaPage>
  /**
   * Real keyset-paginated read of one group's sessions (groupId null = ungrouped), newest first by
   * sortOrder. `cursor` is the previous page's last sortOrder (null = first page); reads only `limit`
   * records from the index, never the whole group.
   */
  getPageByGroup(groupId: string | null, cursor: number | null, limit?: number): Promise<SessionMetaPage>
  getTotal(): Promise<number>
  getTotalByGroup(groupId: string | null): Promise<number>
  clear(): Promise<void>
}

/**
 * Sort session meta records: starred first (by sortOrder desc), then non-starred (by sortOrder desc).
 * Filters out hidden sessions.
 */
export function sortSessionRecords(sessions: SessionMetaRecord[]): SessionMetaRecord[] {
  return sessions
    .filter((s) => !s.hidden)
    .sort((a, b) => {
      if (a.starred && !b.starred) return -1
      if (!a.starred && b.starred) return 1
      return b.sortOrder - a.sortOrder
    })
}

export class IndexedDBSessionMetaStorage implements SessionMetaStorage {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null

  initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.openDatabase()
    return this.initPromise
  }

  private openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)

      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = () => {
        const db = request.result
        const tx = request.transaction
        let store: IDBObjectStore
        if (db.objectStoreNames.contains(STORE_NAME)) {
          if (!tx) return
          store = tx.objectStore(STORE_NAME)
        } else {
          store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('sortOrder', 'sortOrder', { unique: false })
          store.createIndex('createdAt', 'createdAt', { unique: false })
        }
        if (!store.indexNames.contains(GROUP_INDEX)) {
          store.createIndex(GROUP_INDEX, ['groupKey', 'sortOrder'], { unique: false })
          // Backfill `groupKey` on any pre-existing records so they enter the new index.
          const cursorReq = store.openCursor()
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result
            if (!cursor) return
            const rec = cursor.value as SessionMetaRecord & { groupKey?: string }
            const gk = rec.groupId ?? UNGROUPED_KEY
            if (rec.groupKey !== gk) cursor.update({ ...rec, groupKey: gk })
            cursor.continue()
          }
        }
      }
    })
  }

  private getStore(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized')
    const tx = this.db.transaction(STORE_NAME, mode)
    return tx.objectStore(STORE_NAME)
  }

  async create(record: SessionMetaRecord): Promise<void> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.add(toStored(record))
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async createMany(records: SessionMetaRecord[]): Promise<void> {
    await this.initialize()
    if (records.length === 0) return
    return new Promise((resolve, reject) => {
      if (!this.db) throw new Error('Database not initialized')
      const tx = this.db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      for (const record of records) {
        store.put(toStored(record))
      }
    })
  }

  async update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null> {
    await this.initialize()
    const existing = await this.getById(id)
    if (!existing) return null

    const updated = toStored({ ...existing, ...updates })
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.put(updated)
      request.onsuccess = () => resolve(updated)
      request.onerror = () => reject(request.error)
    })
  }

  async getById(id: string): Promise<SessionMetaRecord | null> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result ? fromStored(request.result) : null)
      request.onerror = () => reject(request.error)
    })
  }

  async delete(id: string): Promise<void> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async deleteMany(ids: string[]): Promise<void> {
    await this.initialize()
    if (ids.length === 0) return
    return new Promise((resolve, reject) => {
      if (!this.db) throw new Error('Database not initialized')
      const tx = this.db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      for (const id of ids) {
        store.delete(id)
      }
    })
  }

  async getAll(): Promise<SessionMetaRecord[]> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.getAll()
      request.onsuccess = () => {
        const records = (request.result as Array<SessionMetaRecord & { groupKey?: string }>).map(fromStored)
        resolve(sortSessionRecords(records))
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getPage(cursor: number = 0, limit: number = DEFAULT_PAGE_SIZE): Promise<SessionMetaPage> {
    await this.initialize()
    const all = await this.getAll()
    const items = all.slice(cursor, cursor + limit)
    const nextCursor = cursor + items.length < all.length ? cursor + items.length : null
    return { items, nextCursor, total: all.length }
  }

  async getPageByGroup(
    groupId: string | null,
    cursor: number | null = null,
    limit: number = DEFAULT_PAGE_SIZE
  ): Promise<SessionMetaPage> {
    await this.initialize()
    const groupKey = groupId ?? UNGROUPED_KEY
    // `[groupKey, []]` sorts after every `[groupKey, <number>]` (arrays > numbers in IDB key order),
    // so it is the open upper bound for "all records in this group".
    const range =
      cursor === null
        ? IDBKeyRange.bound([groupKey], [groupKey, []])
        : IDBKeyRange.bound([groupKey], [groupKey, cursor], false, true)
    const items = await new Promise<SessionMetaRecord[]>((resolve, reject) => {
      const out: SessionMetaRecord[] = []
      const index = this.getStore('readonly').index(GROUP_INDEX)
      const req = index.openCursor(range, 'prev')
      req.onsuccess = () => {
        const c = req.result
        if (!c || out.length >= limit) {
          resolve(out)
          return
        }
        const rec = c.value as SessionMetaRecord & { groupKey?: string }
        if (!rec.hidden) out.push(fromStored(rec))
        c.continue()
      }
      req.onerror = () => reject(req.error)
    })
    const nextCursor = items.length >= limit ? (items[items.length - 1]?.sortOrder ?? null) : null
    const total = await this.getTotalByGroup(groupId)
    return { items, nextCursor, total }
  }

  async getTotal(): Promise<number> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getTotalByGroup(groupId: string | null): Promise<number> {
    await this.initialize()
    const groupKey = groupId ?? UNGROUPED_KEY
    return new Promise((resolve, reject) => {
      const index = this.getStore('readonly').index(GROUP_INDEX)
      const request = index.count(IDBKeyRange.bound([groupKey], [groupKey, []]))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async clear(): Promise<void> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.clear()
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
