import type { FolderRepositoryPort } from '@shared/ports'
import type { Folder } from '@shared/types/folder'

const DB_NAME = 'chatbox-folders'
const STORE_NAME = 'records'

/**
 * Storage interface for folder records. Extends {@link FolderRepositoryPort}
 * with `initialize()` so callers can lazily open the database once, mirroring
 * the pattern used by `SessionMetaStorage`.
 */
export interface FolderStorage extends FolderRepositoryPort {
  initialize(): Promise<void>
  create(record: Folder): Promise<void>
  createMany(records: Folder[]): Promise<void>
  update(id: string, updates: Partial<Folder>): Promise<Folder | null>
  delete(id: string): Promise<void>
  deleteMany(ids: string[]): Promise<void>
  getById(id: string): Promise<Folder | null>
  getAll(): Promise<Folder[]>
  getChildren(parentId: string | null): Promise<Folder[]>
  clear(): Promise<void>
}

/**
 * Sort folder children by `sortOrder` descending, matching the session list
 * convention so folders and chats interleave consistently in the tree.
 */
export function sortFolderRecords(records: Folder[]): Folder[] {
  return [...records].sort((a, b) => b.sortOrder - a.sortOrder)
}

export class IndexedDBFolderStorage implements FolderStorage {
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
      // Additive-only schema: open without an explicit version so that downgrade
      // scenarios do not throw VersionError (same rationale as SessionMetaStorage).
      // If a schema change is truly needed, only add stores/indexes (keep keyPath
      // stable) and catch VersionError, then retry with `indexedDB.open(DB_NAME)`.
      const request = indexedDB.open(DB_NAME)

      request.onerror = () => reject(request.error)

      request.onsuccess = () => {
        this.db = request.result
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
        if (!store.indexNames.contains('parentId')) {
          store.createIndex('parentId', 'parentId', { unique: false })
        }
        if (!store.indexNames.contains('sortOrder')) {
          store.createIndex('sortOrder', 'sortOrder', { unique: false })
        }
        if (!store.indexNames.contains('parentSortOrder')) {
          store.createIndex('parentSortOrder', ['parentId', 'sortOrder'], { unique: false })
        }
      }
    })
  }

  private getStore(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized')
    const tx = this.db.transaction(STORE_NAME, mode)
    return tx.objectStore(STORE_NAME)
  }

  async create(record: Folder): Promise<void> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.add(record)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async createMany(records: Folder[]): Promise<void> {
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
  }

  async update(id: string, updates: Partial<Folder>): Promise<Folder | null> {
    await this.initialize()
    const existing = await this.getById(id)
    if (!existing) return null

    const updated: Folder = { ...existing, ...updates, id: existing.id, type: 'folder' }
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.put(updated)
      request.onsuccess = () => resolve(updated)
      request.onerror = () => reject(request.error)
    })
  }

  async getById(id: string): Promise<Folder | null> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.get(id)
      request.onsuccess = () => resolve((request.result as Folder) || null)
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

  private getAllRecords(): Promise<Folder[]> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.getAll()
      request.onsuccess = () => resolve((request.result as Folder[]) || [])
      request.onerror = () => reject(request.error)
    })
  }

  async getAll(): Promise<Folder[]> {
    await this.initialize()
    const records = await this.getAllRecords()
    return sortFolderRecords(records)
  }

  async getChildren(parentId: string | null): Promise<Folder[]> {
    await this.initialize()
    const records = await this.getAllRecords()
    const children = records.filter((folder) => (folder.parentId ?? null) === (parentId ?? null))
    return sortFolderRecords(children)
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
