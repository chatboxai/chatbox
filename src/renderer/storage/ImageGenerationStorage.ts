import type { ImageGeneration, ImageGenerationPage } from '@shared/types'
import { reportDbOpenSucceeded, toDbOpenError, watchDbOpenBlocked, watchDbVersionChange } from './db-schema-guard'

const PAGE_SIZE = 20
const DB_NAME = 'chatbox-image-generation'
const STORE_NAME = 'records'

export interface ImageGenerationStorage {
  initialize(): Promise<void>
  create(record: ImageGeneration): Promise<void>
  update(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | null>
  getById(id: string): Promise<ImageGeneration | null>
  delete(id: string): Promise<void>
  getPage(cursor: number, limit?: number): Promise<ImageGenerationPage>
  getTotal(): Promise<number>
}

export class IndexedDBImageGenerationStorage implements ImageGenerationStorage {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null

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
      const request = indexedDB.open(DB_NAME, 1)
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
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('createdAt', 'createdAt', { unique: false })
        }
      }
    })
  }

  private getStore(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized')
    const tx = this.db.transaction(STORE_NAME, mode)
    return tx.objectStore(STORE_NAME)
  }

  async create(record: ImageGeneration): Promise<void> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readwrite')
      const request = store.add(record)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async update(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | null> {
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
  }

  async getById(id: string): Promise<ImageGeneration | null> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result || null)
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

  async getPage(cursor: number = 0, limit: number = PAGE_SIZE): Promise<ImageGenerationPage> {
    await this.initialize()
    const total = await this.getTotal()

    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const index = store.index('createdAt')
      const items: ImageGeneration[] = []
      let skipped = 0

      const request = index.openCursor(null, 'prev')

      request.onsuccess = (event) => {
        const cursor_ = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (!cursor_) {
          const nextCursor = cursor + items.length < total ? cursor + items.length : null
          resolve({ items, nextCursor, total })
          return
        }

        if (skipped < cursor) {
          skipped++
          cursor_.continue()
          return
        }

        if (items.length < limit) {
          items.push(cursor_.value)
          cursor_.continue()
        } else {
          const nextCursor = cursor + items.length < total ? cursor + items.length : null
          resolve({ items, nextCursor, total })
        }
      }

      request.onerror = () => reject(request.error)
    })
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
}
