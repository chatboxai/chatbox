import type { BackupWorkspace } from '@chatbox/core/backup-v3'
import type { ByteSink, ClosableByteSource } from '@chatbox/core/io'
import { reportDbOpenSucceeded, toDbOpenError, watchDbOpenBlocked, watchDbVersionChange } from './db-schema-guard'

const DB_NAME = 'chatbox-backup-workspaces'
const CHUNK = 256 * 1024
interface CatalogEntry {
  id: number
  job: string
  table: string
  key: string
  value: string
}
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error)
  })
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Backup workspace transaction aborted'))
  })
}
const jobRange = (job: string) => IDBKeyRange.bound([job], [job, []])

/** Durable chunk files and ordered indexes; no archive-sized strings or arrays. */
export class IndexedDBBackupWorkspace implements BackupWorkspace {
  private db: IDBDatabase | null = null
  private opening: Promise<IDBDatabase> | null = null
  private disposed = false
  constructor(readonly jobId: string) {}
  async initialize(): Promise<IDBDatabase> {
    if (this.disposed) throw new Error('Backup workspace is disposed')
    if (this.db) return this.db
    if (!this.opening)
      this.opening = new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(DB_NAME)
        watchDbOpenBlocked(DB_NAME, open)
        open.onupgradeneeded = () => {
          const db = open.result
          if (!db.objectStoreNames.contains('files')) db.createObjectStore('files')
          if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks')
          if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs')
          if (!db.objectStoreNames.contains('catalog')) {
            const catalog = db.createObjectStore('catalog', { keyPath: 'id', autoIncrement: true })
            catalog.createIndex('key', ['job', 'table', 'key'], { unique: true })
            catalog.createIndex('order', ['job', 'table', 'id'])
          }
        }
        open.onerror = () => reject(toDbOpenError(DB_NAME, open.error))
        open.onsuccess = () => {
          const db = open.result
          watchDbVersionChange(DB_NAME, db, () => {
            this.db = null
            this.opening = null
          })
          reportDbOpenSucceeded(DB_NAME)
          this.db = db
          resolve(db)
        }
      }).catch((error) => {
        this.opening = null
        throw error
      })
    const db = await this.opening
    const tx = db.transaction('jobs', 'readwrite'),
      done = complete(tx)
    tx.objectStore('jobs').put(true, this.jobId)
    await done
    return db
  }
  async createFile(name: string): Promise<ByteSink> {
    const db = await this.initialize()
    const tx = db.transaction(['files', 'chunks'], 'readwrite'),
      done = complete(tx)
    tx.objectStore('files').add({ size: 0, closed: false }, [this.jobId, name])
    await done
    let size = 0,
      index = 0,
      used = 0,
      closed = false
    const buffer = new Uint8Array(CHUNK)
    const flush = async () => {
      if (!used) return
      const tx = db.transaction('chunks', 'readwrite'),
        done = complete(tx)
      tx.objectStore('chunks').add(buffer.slice(0, used), [this.jobId, name, index++])
      used = 0
      await done
    }
    return {
      write: async (bytes) => {
        if (closed) throw new Error('Backup file is closed')
        size += bytes.length
        for (let offset = 0; offset < bytes.length; ) {
          const count = Math.min(CHUNK - used, bytes.length - offset)
          buffer.set(bytes.subarray(offset, offset + count), used)
          used += count
          offset += count
          if (used === CHUNK) await flush()
        }
      },
      close: async () => {
        if (closed) return
        await flush()
        const tx = db.transaction('files', 'readwrite'),
          done = complete(tx)
        tx.objectStore('files').put({ size, closed: true }, [this.jobId, name])
        await done
        closed = true
      },
      abort: async () => {
        closed = true
        const tx = db.transaction(['files', 'chunks'], 'readwrite'),
          done = complete(tx)
        tx.objectStore('files').delete([this.jobId, name])
        tx.objectStore('chunks').delete(IDBKeyRange.bound([this.jobId, name], [this.jobId, name, []]))
        await done
      },
    }
  }
  async openFile(name: string): Promise<ClosableByteSource> {
    const db = await this.initialize()
    const descriptor = (await request(db.transaction('files').objectStore('files').get([this.jobId, name]))) as
      | { size: number; closed: boolean }
      | undefined
    if (!descriptor?.closed) throw new Error('Backup file is unavailable')
    let closed = false
    const readBytes = async (offset: number, length: number) => {
      if (closed) throw new Error('Backup file is closed')
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > descriptor.size ||
        !Number.isSafeInteger(length) ||
        length < 0
      )
        throw new Error('Invalid backup file range')
      const result = new Uint8Array(Math.min(length, descriptor.size - offset))
      for (let written = 0; written < result.length; ) {
        const position = offset + written,
          index = Math.floor(position / CHUNK)
        const chunk = (await request(db.transaction('chunks').objectStore('chunks').get([this.jobId, name, index]))) as
          | Uint8Array
          | undefined
        if (!chunk) throw new Error('Backup file chunk is missing')
        const start = position % CHUNK,
          count = Math.min(chunk.length - start, result.length - written)
        if (count <= 0) throw new Error('Backup file chunk is truncated')
        result.set(chunk.subarray(start, start + count), written)
        written += count
      }
      return result
    }
    return {
      size: descriptor.size,
      readBytes,
      close: async () => {
        closed = true
      },
      async *chunks() {
        for (let offset = 0; offset < descriptor.size; offset += CHUNK)
          yield await readBytes(offset, Math.min(CHUNK, descriptor.size - offset))
      },
    }
  }
  async put(table: string, key: string, value: string): Promise<boolean> {
    const db = await this.initialize(),
      tx = db.transaction('catalog', 'readwrite'),
      done = complete(tx),
      store = tx.objectStore('catalog')
    const exists = await request(store.index('key').getKey([this.jobId, table, key]))
    if (exists !== undefined) {
      await done
      return false
    }
    store.add({ job: this.jobId, table, key, value })
    await done
    return true
  }
  async get(table: string, key: string): Promise<string | null> {
    const db = await this.initialize()
    const entry = (await request(
      db.transaction('catalog').objectStore('catalog').index('key').get([this.jobId, table, key])
    )) as CatalogEntry | undefined
    return entry?.value ?? null
  }
  async *entries(table: string): AsyncIterable<{ key: string; value: string }> {
    const db = await this.initialize()
    let after = 0
    while (true) {
      const range = IDBKeyRange.bound([this.jobId, table, after], [this.jobId, table, Number.MAX_SAFE_INTEGER], true)
      const page = (await request(
        db.transaction('catalog').objectStore('catalog').index('order').getAll(range, 64)
      )) as CatalogEntry[]
      if (!page.length) return
      for (const entry of page) yield { key: entry.key, value: entry.value }
      after = page[page.length - 1].id
    }
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    const db = await this.initialize(),
      tx = db.transaction(['catalog', 'files', 'chunks', 'jobs'], 'readwrite'),
      done = complete(tx)
    tx.objectStore('files').delete(jobRange(this.jobId))
    tx.objectStore('chunks').delete(jobRange(this.jobId))
    const cursor = tx.objectStore('catalog').index('key').openCursor(jobRange(this.jobId))
    cursor.onsuccess = () => {
      if (cursor.result) {
        cursor.result.delete()
        cursor.result.continue()
      }
    }
    tx.objectStore('jobs').delete(this.jobId)
    await done
    this.disposed = true
    db.close()
    this.db = null
    this.opening = null
  }
  async listJobIds(): Promise<string[]> {
    const db = await this.initialize()
    return (await request(db.transaction('jobs').objectStore('jobs').getAllKeys())) as string[]
  }
}
