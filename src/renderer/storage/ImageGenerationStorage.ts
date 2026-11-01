import type { ImageGeneration, ImageGenerationPage } from '@shared/types'
import { reportDbOpenSucceeded, toDbOpenError, watchDbOpenBlocked, watchDbVersionChange } from './db-schema-guard'

const PAGE_SIZE = 20
const DB_NAME = 'chatbox-image-generation'
const STORE_NAME = 'records'

/**
 * Records already on disk are not guaranteed to carry every field the schema declares.
 * Reads must stay renderable, so fill the required fields consumers dereference. Writes
 * stay strict, so a record that loses a field still surfaces as a bug at its source.
 */
function normalizeRecord(record: ImageGeneration): ImageGeneration {
  if (record.model && record.prompt && record.referenceImages && record.generatedImages) return record
  return {
    ...record,
    model: record.model ?? { provider: '', modelId: '' },
    prompt: record.prompt ?? '',
    referenceImages: record.referenceImages ?? [],
    generatedImages: record.generatedImages ?? [],
  }
}

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
      request.onsuccess = () => resolve(request.result ? normalizeRecord(request.result) : null)
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
    const total = await this.countListable()

    return new Promise((resolve, reject) => {
      const store = this.getStore('readonly')
      const index = store.index('createdAt')
      const items: ImageGeneration[] = []
      let skipped = 0

      const request = index.openCursor(null, 'prev')

      request.onsuccess = (event) => {
        const cursor_ = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (!cursor_) {
          resolve({ items, nextCursor: null, total })
          return
        }

        if (skipped < cursor) {
          skipped++
          cursor_.continue()
          return
        }

        if (items.length < limit) {
          items.push(normalizeRecord(cursor_.value))
          cursor_.continue()
        } else {
          resolve({ items, nextCursor: cursor + items.length, total })
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  /**
   * A record is only listable once it is in the createdAt index, so paging counts and
   * terminates on that index rather than on the store's full record count.
   */
  private async countListable(): Promise<number> {
    await this.initialize()
    return new Promise((resolve, reject) => {
      const request = this.getStore('readonly').index('createdAt').count()
      request.onsuccess = () => resolve(request.result)
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
