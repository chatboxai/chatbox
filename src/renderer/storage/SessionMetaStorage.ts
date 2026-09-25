import type { SessionMetaRepositoryPort } from '@chatbox/core/ports'
import { applySortedSessionRecord, sortSessionRecords } from '@chatbox/core/utils/session-sort'
import type { SessionMetaPage, SessionMetaRecord } from '@shared/types'
import { reportDbOpenSucceeded, toDbOpenError, watchDbOpenBlocked, watchDbVersionChange } from './db-schema-guard'

const DB_NAME = 'chatbox-session-meta'
const STORE_NAME = 'records'
const DEFAULT_PAGE_SIZE = 50

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
  // Visible records in folder display order. No index matches that order, so
  // one full read serves every page; writes through this instance patch it.
  private folderOrderSnapshot: { key: string; folderIds: readonly string[]; records: SessionMetaRecord[] } | null = null
  private writeGeneration = 0

  /**
   * Runs a write and applies `patch` to the folder order snapshot once it has
   * committed. A failed write drops the snapshot, since the stored state is
   * then unknown.
   */
  private async write<T>(
    operation: () => Promise<T>,
    patch: (records: SessionMetaRecord[], result: T, folderIds: readonly string[]) => void
  ): Promise<T> {
    this.writeGeneration += 1
    try {
      const result = await operation()
      const snapshot = this.folderOrderSnapshot
      if (snapshot) patch(snapshot.records, result, snapshot.folderIds)
      return result
    } catch (error) {
      this.folderOrderSnapshot = null
      throw error
    } finally {
      this.writeGeneration += 1
    }
  }

  private async getFolderOrderedRecords(folderIds: readonly string[]): Promise<SessionMetaRecord[]> {
    const key = folderIds.join('\u0000')
    if (this.folderOrderSnapshot?.key === key) return this.folderOrderSnapshot.records
    const generation = this.writeGeneration
    const records = sortSessionRecords(await this.getAllRecords(), folderIds)
    // A write that landed during the read may be missing from `records`.
    if (generation === this.writeGeneration) this.folderOrderSnapshot = { key, folderIds: [...folderIds], records }
    return records
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
      async () => {
        await this.initialize()
        return new Promise((resolve, reject) => {
          const store = this.getStore('readwrite')
          const request = store.add(record)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })
      },
      (records, _result, folderIds) => applySortedSessionRecord(records, record, folderIds)
    )
  }

  createMany(records: SessionMetaRecord[]): Promise<void> {
    return this.write(
      async () => {
        await this.initialize()
        if (records.length === 0) return
        return new Promise((resolve, reject) => {
          if (!this.db) throw new Error('Database not initialized')
          const tx = this.db.transaction(STORE_NAME, 'readwrite')
          const store = tx.objectStore(STORE_NAME)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          for (const record of records) {
            store.put(record)
          }
        })
      },
      (snapshot, _result, folderIds) => {
        for (const record of records) applySortedSessionRecord(snapshot, record, folderIds)
      }
    )
  }

  update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null> {
    return this.write(
      async () => {
        await this.initialize()
        const existing = await this.getById(id)
        if (!existing) return null

        const updated = { ...existing, ...updates }
        return new Promise((resolve, reject) => {
          const store = this.getStore('readwrite')
          const request = store.put(updated)
          request.onsuccess = () => resolve(updated)
          request.onerror = () => reject(request.error)
        })
      },
      (records, updated, folderIds) => {
        if (updated) applySortedSessionRecord(records, updated, folderIds)
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
      async () => {
        await this.initialize()
        return new Promise((resolve, reject) => {
          const store = this.getStore('readwrite')
          const request = store.delete(id)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })
      },
      (records) => {
        const index = records.findIndex((record) => record.id === id)
        if (index >= 0) records.splice(index, 1)
      }
    )
  }

  deleteMany(ids: string[]): Promise<void> {
    return this.write(
      async () => {
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
      this.getRecordsPage({
        cursor,
        limit,
        indexName: 'archivedAt',
        direction: 'prev',
        filter: (record) => record.archivedAt !== undefined,
      }),
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
    if (folderIds.length > 0) {
      const visible = await this.getFolderOrderedRecords(folderIds)
      const items = visible.slice(cursor, cursor + limit)
      const nextCursor = cursor + items.length < visible.length ? cursor + items.length : null
      return { items, nextCursor, total: visible.length }
    }
    const [items, total] = await Promise.all([this.getVisibleRecordsPage(cursor, limit), this.getTotal()])
    const nextCursor = cursor + items.length < total ? cursor + items.length : null
    return { items, nextCursor, total }
  }

  async getTotal(): Promise<number> {
    await this.initialize()
    return await this.countRecords((record) => !record.hidden)
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
    return await this.countRecords((record) => record.archivedAt !== undefined)
  }

  private async getVisibleRecordsPage(cursor: number, limit: number): Promise<SessionMetaRecord[]> {
    const items: SessionMetaRecord[] = []
    let skipped = 0

    skipped = await this.collectRecordsPage({
      items,
      skipped,
      cursor,
      limit,
      indexName: 'sortOrder',
      direction: 'prev',
      filter: (record) => !record.hidden && record.starred === true,
    })

    if (items.length < limit) {
      await this.collectRecordsPage({
        items,
        skipped,
        cursor,
        limit,
        indexName: 'sortOrder',
        direction: 'prev',
        filter: (record) => !record.hidden && record.starred !== true,
      })
    }

    return items
  }

  private collectRecordsPage({
    items,
    skipped,
    cursor,
    limit,
    indexName,
    direction,
    filter,
  }: {
    items: SessionMetaRecord[]
    skipped: number
    cursor: number
    limit: number
    indexName: string
    direction: IDBCursorDirection
    filter: (record: SessionMetaRecord) => boolean
  }): Promise<number> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const source = store.indexNames.contains(indexName) ? store.index(indexName) : store
      const request = source.openCursor(null, direction)
      let skippedCount = skipped

      request.onsuccess = () => {
        const cursorResult = request.result
        if (!cursorResult || items.length >= limit) {
          resolve(skippedCount)
          return
        }

        const record = cursorResult.value as SessionMetaRecord
        if (!filter(record)) {
          cursorResult.continue()
          return
        }
        if (skippedCount < cursor) {
          skippedCount += 1
          cursorResult.continue()
          return
        }

        items.push(record)
        cursorResult.continue()
      }
      request.onerror = () => reject(request.error)
    })
  }

  private getRecordsPage({
    cursor,
    limit,
    indexName,
    direction,
    filter,
  }: {
    cursor: number
    limit: number
    indexName: string
    direction: IDBCursorDirection
    filter: (record: SessionMetaRecord) => boolean
  }): Promise<SessionMetaRecord[]> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const source = store.indexNames.contains(indexName) ? store.index(indexName) : store
      const request = source.openCursor(null, direction)
      const items: SessionMetaRecord[] = []
      let skipped = 0

      request.onsuccess = () => {
        const cursorResult = request.result
        if (!cursorResult || items.length >= limit) {
          resolve(items)
          return
        }

        const record = cursorResult.value as SessionMetaRecord
        if (!filter(record)) {
          cursorResult.continue()
          return
        }
        if (skipped < cursor) {
          skipped += 1
          cursorResult.continue()
          return
        }

        items.push(record)
        cursorResult.continue()
      }
      request.onerror = () => reject(request.error)
    })
  }

  private countRecords(filter: (record: SessionMetaRecord) => boolean): Promise<number> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.openCursor()
      let total = 0

      request.onsuccess = () => {
        const cursorResult = request.result
        if (!cursorResult) {
          resolve(total)
          return
        }
        if (filter(cursorResult.value as SessionMetaRecord)) {
          total += 1
        }
        cursorResult.continue()
      }
      request.onerror = () => reject(request.error)
    })
  }

  clear(): Promise<void> {
    return this.write(
      async () => {
        await this.initialize()
        return new Promise((resolve, reject) => {
          const store = this.getStore('readwrite')
          const request = store.clear()
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })
      },
      (records) => {
        records.length = 0
      }
    )
  }
}
