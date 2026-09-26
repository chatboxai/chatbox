import type { SessionMetaRepositoryPort } from '@chatbox/core/ports'
import { applySortedSessionRecord, sortSessionRecords } from '@chatbox/core/utils/session-sort'
import type { SessionMetaPage, SessionMetaRecord } from '@shared/types'
import { reportDbOpenSucceeded, toDbOpenError, watchDbOpenBlocked, watchDbVersionChange } from './db-schema-guard'

const DB_NAME = 'chatbox-session-meta'
const STORE_NAME = 'records'
const DEFAULT_PAGE_SIZE = 50
// Instances in other tabs of the same origin post here after each write, so
// their snapshots of the list are rebuilt from storage.
const CHANGE_CHANNEL_NAME = 'chatbox-session-meta-changes'
// One order for the sidebar list and one for flat reads such as search.
const MAX_SNAPSHOTS = 2

export type SessionMetaStorage = SessionMetaRepositoryPort

// Sort logic shared with the native mobile shell.
export { sortSessionRecords }

function sortArchivedSessionRecords(records: SessionMetaRecord[]): SessionMetaRecord[] {
  return records
    .filter((record) => record.archivedAt !== undefined)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
}

export class IndexedDBSessionMetaStorage implements SessionMetaStorage {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null
  // Visible records in list display order, keyed by folder order. Hidden records
  // (archived, sub-agent and other hidden sessions) can outnumber visible ones many
  // times over and no index excludes them, so one full read serves every page and
  // count; another folder order is sorted from a snapshot already in memory, and
  // writes through this instance patch every snapshot.
  private visibleSnapshots = new Map<string, { folderIds: readonly string[]; records: SessionMetaRecord[] }>()
  private writeGeneration = 0
  private changeChannel: BroadcastChannel | null = null

  constructor() {
    if (typeof BroadcastChannel === 'undefined') return
    this.changeChannel = new BroadcastChannel(CHANGE_CHANNEL_NAME)
    this.changeChannel.onmessage = () => {
      this.visibleSnapshots.clear()
      // A read in flight may predate the other tab's write.
      this.writeGeneration += 1
    }
  }

  /**
   * Runs a write and applies `patch` to each visible snapshot once it has
   * committed. A failed write drops the snapshots, since the stored state is
   * then unknown.
   */
  private async write<T>(
    operation: () => Promise<T>,
    patch: (records: SessionMetaRecord[], result: T, folderIds: readonly string[]) => void
  ): Promise<T> {
    this.writeGeneration += 1
    try {
      const result = await operation()
      for (const snapshot of this.visibleSnapshots.values()) patch(snapshot.records, result, snapshot.folderIds)
      return result
    } catch (error) {
      this.visibleSnapshots.clear()
      throw error
    } finally {
      this.writeGeneration += 1
      this.changeChannel?.postMessage('changed')
    }
  }

  private async getVisibleRecords(folderIds: readonly string[]): Promise<SessionMetaRecord[]> {
    const key = folderIds.join('\u0000')
    const cached = this.visibleSnapshots.get(key)
    if (cached) {
      this.visibleSnapshots.delete(key)
      this.visibleSnapshots.set(key, cached)
      return cached.records
    }
    const generation = this.writeGeneration
    const inMemory = this.visibleSnapshots.values().next().value
    const records = sortSessionRecords(inMemory ? [...inMemory.records] : await this.getAllRecords(), folderIds)
    // A write that landed during the read may be missing from `records`.
    if (generation === this.writeGeneration) {
      this.visibleSnapshots.set(key, { folderIds: [...folderIds], records })
      if (this.visibleSnapshots.size > MAX_SNAPSHOTS) {
        const oldest = this.visibleSnapshots.keys().next().value
        if (oldest !== undefined) this.visibleSnapshots.delete(oldest)
      }
    }
    return records
  }

  /** Runs one read-write transaction and settles once it has committed or failed. */
  private async commit<T>(run: (store: IDBObjectStore) => T): Promise<T> {
    await this.initialize()
    if (!this.db) throw new Error('Database not initialized')
    const tx = this.db.transaction(STORE_NAME, 'readwrite')
    const result = run(tx.objectStore(STORE_NAME))
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(result)
      // The failing request's error reaches the transaction before tx.error is set.
      tx.onerror = (event) => reject((event.target as IDBRequest | null)?.error ?? tx.error)
      tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'))
    })
  }

  initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.openDatabase().catch((error) => {
        this.initPromise = null
        throw error
      })
    }
    return this.initPromise
  }

  private openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 这些索引只是性能优化，没有很强的 schema 迁移理由，去掉了强制指定 version。
      // bump 后用户回退版本会因 VersionError 打不开 session meta DB，导致降级使用失败：
      // `The requested version (X) is less than the existing version (Y)` —— 例如 1.22 → 1.21 降级后无法发消息。
      // 如确需引入 version/schema 变更：只做加法式变更（新 store/索引，keyPath 不变），
      // 并保留 db-schema-guard，让降级产生的 VersionError 显示更新引导，而不是静默改写数据。
      const request = indexedDB.open(DB_NAME)
      watchDbOpenBlocked(DB_NAME, request)

      request.onerror = () => reject(toDbOpenError(DB_NAME, request.error))

      request.onsuccess = () => {
        const db = request.result
        this.db = db
        reportDbOpenSucceeded(DB_NAME)
        watchDbVersionChange(DB_NAME, db, () => {
          if (this.db === db) {
            this.db = null
            this.initPromise = null
          }
        })
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? request.transaction?.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        if (!store) {
          return
        }
        if (!store.indexNames.contains('sortOrder')) {
          store.createIndex('sortOrder', 'sortOrder', { unique: false })
        }
        if (!store.indexNames.contains('createdAt')) {
          store.createIndex('createdAt', 'createdAt', { unique: false })
        }
        if (!store.indexNames.contains('starredSortOrder')) {
          store.createIndex('starredSortOrder', ['starred', 'sortOrder'], { unique: false })
        }
        if (!store.indexNames.contains('archivedAt')) {
          store.createIndex('archivedAt', 'archivedAt', { unique: false })
        }
      }
    })
  }

  private getStore(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized')
    const tx = this.db.transaction(STORE_NAME, mode)
    return tx.objectStore(STORE_NAME)
  }

  create(record: SessionMetaRecord): Promise<void> {
    return this.write(
      () =>
        this.commit((store) => {
          store.add(record)
        }),
      (records, _result, folderIds) => applySortedSessionRecord(records, { ...record }, folderIds)
    )
  }

  createMany(records: SessionMetaRecord[]): Promise<void> {
    return this.write(
      async () => {
        if (records.length === 0) return
        await this.commit((store) => {
          for (const record of records) store.put(record)
        })
      },
      (snapshot, _result, folderIds) => {
        for (const record of records) applySortedSessionRecord(snapshot, { ...record }, folderIds)
      }
    )
  }

  update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null> {
    return this.write(
      async () => {
        const existing = await this.getById(id)
        if (!existing) return null
        const updated = { ...existing, ...updates }
        await this.commit((store) => {
          store.put(updated)
        })
        return updated
      },
      (records, updated, folderIds) => {
        if (updated) applySortedSessionRecord(records, { ...updated }, folderIds)
      }
    )
  }

  async getById(id: string): Promise<SessionMetaRecord | null> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  delete(id: string): Promise<void> {
    return this.write(
      () =>
        this.commit((store) => {
          store.delete(id)
        }),
      (records) => {
        const index = records.findIndex((record) => record.id === id)
        if (index >= 0) records.splice(index, 1)
      }
    )
  }

  deleteMany(ids: string[]): Promise<void> {
    return this.write(
      async () => {
        if (ids.length === 0) return
        await this.commit((store) => {
          for (const id of ids) store.delete(id)
        })
      },
      (records) => {
        const deleted = new Set(ids)
        let kept = 0
        for (const record of records) {
          if (!deleted.has(record.id)) records[kept++] = record
        }
        records.length = kept
      }
    )
  }

  async getAll(): Promise<SessionMetaRecord[]> {
    await this.initialize()
    const records = await this.getAllRecords()
    return sortSessionRecords(records)
  }

  async getAllIncludingHidden(): Promise<SessionMetaRecord[]> {
    await this.initialize()
    const records = await this.getAllRecords()
    return records.sort((a, b) => b.sortOrder - a.sortOrder)
  }

  async getArchived(): Promise<SessionMetaRecord[]> {
    await this.initialize()
    const records = await this.getAllRecords()
    return sortArchivedSessionRecords(records)
  }

  async getArchivedPage(cursor: number = 0, limit: number = DEFAULT_PAGE_SIZE): Promise<SessionMetaPage> {
    await this.initialize()
    if (!this.hasIndex('archivedAt')) {
      const all = await this.getArchived()
      const items = all.slice(cursor, cursor + limit)
      const nextCursor = cursor + items.length < all.length ? cursor + items.length : null
      return { items, nextCursor, total: all.length }
    }

    const [items, total] = await Promise.all([
      this.getIndexPage('archivedAt', 'prev', cursor, limit),
      this.getArchivedTotal(),
    ])
    const nextCursor = cursor + items.length < total ? cursor + items.length : null
    return { items, nextCursor, total }
  }

  private hasIndex(indexName: string): boolean {
    const store = this.getStore('readonly')
    return store.indexNames.contains(indexName)
  }

  private getAllRecords(): Promise<SessionMetaRecord[]> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.getAll()
      request.onsuccess = () => {
        const records = request.result as SessionMetaRecord[]
        resolve(records)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getPage(
    cursor: number = 0,
    limit: number = DEFAULT_PAGE_SIZE,
    folderIds: readonly string[] = []
  ): Promise<SessionMetaPage> {
    await this.initialize()
    const visible = await this.getVisibleRecords(folderIds)
    // Copies, so a caller changing a returned record cannot change the snapshot.
    const items = visible.slice(cursor, cursor + limit).map((record) => ({ ...record }))
    const nextCursor = cursor + items.length < visible.length ? cursor + items.length : null
    return { items, nextCursor, total: visible.length }
  }

  async getTotal(): Promise<number> {
    await this.initialize()
    // The visible count does not depend on folder order, so any snapshot answers it.
    const snapshot = this.visibleSnapshots.values().next().value
    const visible = await this.getVisibleRecords(snapshot?.folderIds ?? [])
    return visible.length
  }

  async getAllTotal(): Promise<number> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getArchivedTotal(): Promise<number> {
    await this.initialize()
    if (!this.hasIndex('archivedAt')) return (await this.getArchived()).length
    // The archivedAt index holds exactly the records that have archivedAt.
    return new Promise((resolve, reject) => {
      const request = this.getStore('readonly').index('archivedAt').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  /** One page of an index in `direction` order, skipping the first `cursor` entries without reading them. */
  private getIndexPage(
    indexName: string,
    direction: IDBCursorDirection,
    cursor: number,
    limit: number
  ): Promise<SessionMetaRecord[]> {
    return new Promise((resolve, reject) => {
      const request = this.getStore('readonly').index(indexName).openCursor(null, direction)
      const items: SessionMetaRecord[] = []
      let skipped = cursor === 0

      request.onsuccess = () => {
        const cursorResult = request.result
        if (!cursorResult || items.length >= limit) {
          resolve(items)
          return
        }
        if (!skipped) {
          skipped = true
          cursorResult.advance(cursor)
          return
        }
        items.push(cursorResult.value as SessionMetaRecord)
        cursorResult.continue()
      }
      request.onerror = () => reject(request.error)
    })
  }

  clear(): Promise<void> {
    return this.write(
      () =>
        this.commit((store) => {
          store.clear()
        }),
      (records) => {
        records.length = 0
      }
    )
  }
}
