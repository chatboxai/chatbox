import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import localforage from 'localforage'
import { v4 as uuidv4 } from 'uuid'
import { StorageKey } from '@/storage'
import { reportError } from '@/utils/sentry'
import platform from '.'
import type { Storage } from './interfaces'

const DIAGNOSTIC_KEY_SUFFIXES = ['_tokenMap', '_parserType'] as const

// Storage keys can embed file names, URLs and session ids, so telemetry only
// ever sees the stable prefix / known-suffix shape (e.g. `file:*_tokenMap`).
function sanitizeStoreKeyForDiagnostics(key: string): string {
  const suffix = DIAGNOSTIC_KEY_SUFFIXES.find((candidate) => key.endsWith(candidate)) ?? ''
  const base = suffix ? key.slice(0, key.length - suffix.length) : key
  const colonIndex = base.indexOf(':')
  if (colonIndex >= 0) return `${base.slice(0, colonIndex)}:*${suffix}`
  return /^[\w.-]{1,48}$/.test(base) ? `${base}${suffix}` : `*${suffix}`
}

const reportedNonSerializableKeys = new Set<string>()

// JSON.stringify returns undefined (not a string) when the root value is
// undefined, a function or a symbol. The storage drivers only accept strings,
// so coerce such writes to the JSON null literal — the row reads back as null,
// matching what the pre-chunking SQLite writer persisted — and report the
// sanitized key so the caller can be identified in production.
function serializeStoreValue(storageType: string, key: string, value: unknown): string {
  const json = JSON.stringify(value)
  if (typeof json === 'string') return json
  const sanitizedKey = sanitizeStoreKeyForDiagnostics(key)
  console.error(`Storage received a non-serializable value (type: ${typeof value}) for key "${sanitizedKey}"`)
  if (!reportedNonSerializableKeys.has(sanitizedKey)) {
    reportedNonSerializableKeys.add(sanitizedKey)
    reportError(new Error('Storage write received a value that serialized to a non-string'), {
      domain: 'storage',
      operation: 'serialize_store_value',
      tags: { storage_type: storageType, storage_key: sanitizedKey, value_type: typeof value },
    })
  }
  return 'null'
}

export class DesktopFileStorage implements Storage {
  public ipc = window.electronAPI

  public getStorageType(): string {
    return 'DESKTOP_FILE'
  }

  public async setStoreValue(key: string, value: any) {
    // 为什么要序列化？
    // 为了实现进程通信，electron invoke 会自动对传输数据进行序列化，
    // 但如果数据包含无法被序列化的类型（比如函数）将直接报错：
    // Uncaught (in promise) Error: An object could not be cloned.
    // 因此对于数据类型不容易控制的场景，应该提前 JSON.stringify，这种序列化方式会自动处理异常类型。
    const valueJson = JSON.stringify(value)
    return this.ipc.invoke('setStoreValue', key, valueJson)
  }
  public async getStoreValue(key: string) {
    return this.ipc.invoke('getStoreValue', key)
  }
  public delStoreValue(key: string) {
    return this.ipc.invoke('delStoreValue', key)
  }
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const json = await this.ipc.invoke('getAllStoreValues')
    return JSON.parse(json)
  }
  public async getAllStoreKeys(): Promise<string[]> {
    return this.ipc.invoke('getAllStoreKeys')
  }
  public async setAllStoreValues(data: { [key: string]: any }) {
    await this.ipc.invoke('setAllStoreValues', JSON.stringify(data))
  }
}

export class LocalStorage implements Storage {
  // 使用LocalStorage存储的最后一个版本是ConfigVersion=6，当时只有这些key
  validStorageKeys: string[] = [
    StorageKey.ConfigVersion,
    StorageKey.Configs,
    StorageKey.Settings,
    StorageKey.MyCopilots,
    StorageKey.ChatSessions,
  ]

  public getStorageType(): string {
    return 'LOCAL_STORAGE'
  }

  public async setStoreValue(key: string, value: any) {
    // 为什么序列化成 JSON？
    // 因为 IndexedDB 作为底层驱动时，可以直接存储对象，但是如果对象中包含函数或引用，将会直接报错
    localStorage.setItem(key, JSON.stringify(value))
  }
  public async getStoreValue(key: string) {
    const json = localStorage.getItem(key)
    return json ? JSON.parse(json) : null
  }
  public async delStoreValue(key: string) {
    return localStorage.removeItem(key)
  }
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const ret: { [key: string]: any } = {}

    // 仅返回有效的key
    for (const key of this.validStorageKeys) {
      const val = localStorage.getItem(key)
      if (val) {
        try {
          ret[key] = JSON.parse(val)
        } catch (error) {
          console.error(`Failed to parse stored value for key "${key}":`, error)
        }
      }
    }

    return ret
  }
  public async getAllStoreKeys(): Promise<string[]> {
    // 仅返回有效的key
    return Object.keys(localStorage).filter((k) => this.validStorageKeys.includes(k))
  }
  public async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.setStoreValue(key, value)
    }
  }
}

class SQLiteStorage {
  private static readonly BRIDGE_CHUNK_SIZE = 256 * 1024
  private static readonly CHUNKS_PER_WRITE = 2
  private static readonly MANIFEST_PEEK_LENGTH = 128
  private static readonly COMPACT_MIN_FREE_BYTES = 8 * 1024 * 1024
  private static readonly COMPACT_MIN_FREE_RATIO = 0.25
  // Even six-times JSON escaping keeps a complete small value below 100 KiB.
  private static readonly INLINE_READ_BYTES = 16 * 1024
  // hex() doubles the payload, so this keeps a 512 KiB bridge string — the same
  // budget already used by writing two 256 KiB chunks in one executeSet.
  private static readonly BLOB_SLICE_SIZE = 256 * 1024
  private static readonly CHUNKED_VALUE_PREFIX = '__CHATBOX_CHUNKED_VALUE_V1__:'
  private sqlite: SQLiteConnection
  private database!: SQLiteDBConnection
  private initializePromise: Promise<void> | null = null
  private operationQueues = new Map<string, Promise<unknown>>()

  constructor(private readonly injectedDatabase?: SQLiteDBConnection) {
    this.sqlite = new SQLiteConnection(CapacitorSQLite)
    if (injectedDatabase) this.database = injectedDatabase
  }

  // 创建并打开数据库
  private async initialize(): Promise<void> {
    try {
      // A WebView reload can leave a native connection from the previous JS context.
      try {
        await this.sqlite.closeConnection('chatbox.db', false)
      } catch {
        // A fresh launch has no previous connection.
      }
      this.database = await this.sqlite.createConnection('chatbox.db', false, 'no-encryption', 1, false)

      await this.database.open()
      await this.initializeSchema()
    } catch (error) {
      console.error('Failed to initialize database', error)
      throw error
    }
  }

  private async initializeSchema(): Promise<void> {
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS key_value (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
      );
    `)
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS key_value_chunks (
        key TEXT NOT NULL,
        generation TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (key, generation, chunk_index)
      );
    `)
    await this.cleanupUnreferencedChunks()
  }

  // 确保数据库初始化完成
  private async ensureInitialized(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = (this.injectedDatabase ? this.initializeSchema() : this.initialize()).catch(
        (error: unknown) => {
          this.initializePromise = null
          throw error
        }
      )
    }
    await this.initializePromise
  }

  private parseChunkManifest(value: string | null): { generation: string; chunkCount: number; length: number } | null {
    if (!value?.startsWith(SQLiteStorage.CHUNKED_VALUE_PREFIX)) return null
    const fields = value.slice(SQLiteStorage.CHUNKED_VALUE_PREFIX.length).split(':')
    if (fields.length !== 3) return null
    const [generation, chunkCountValue, lengthValue] = fields
    const chunkCount = Number(chunkCountValue)
    const length = Number(lengthValue)
    if (
      !generation ||
      !Number.isSafeInteger(chunkCount) ||
      chunkCount < 1 ||
      !Number.isSafeInteger(length) ||
      length < 1
    ) {
      return null
    }
    return { generation, chunkCount, length }
  }

  private createChunkManifest(generation: string, chunkCount: number, length: number): string {
    return `${SQLiteStorage.CHUNKED_VALUE_PREFIX}${generation}:${chunkCount}:${length}`
  }

  private splitValue(value: string): string[] {
    const chunks: string[] = []
    let offset = 0
    while (offset < value.length) {
      let end = Math.min(offset + SQLiteStorage.BRIDGE_CHUNK_SIZE, value.length)
      const finalCodeUnit = value.charCodeAt(end - 1)
      if (end < value.length && finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end--
      chunks.push(value.slice(offset, end))
      offset = end
    }
    return chunks
  }

  private decodeHex(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) throw new Error('Stored value blob slice is not valid hex')
    const bytes = new Uint8Array(hex.length / 2)
    for (let index = 0; index < bytes.length; index++) {
      const high = Number.parseInt(hex.slice(index * 2, index * 2 + 1), 16)
      const low = Number.parseInt(hex.slice(index * 2 + 1, index * 2 + 2), 16)
      if (Number.isNaN(high) || Number.isNaN(low)) throw new Error('Stored value blob slice is not valid hex')
      bytes[index] = (high << 4) | low
    }
    return bytes
  }

  private toByteLength(value: unknown): number | null {
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value !== '') return Number(value)
    return null
  }

  private async readValueHead(
    key: string
  ): Promise<{ kind: 'complete'; value: string } | { kind: 'prefix'; value: string; byteLength: number } | null> {
    const result = await this.database.query(
      `
        WITH stored AS (
          SELECT value, length(CAST(value AS BLOB)) AS value_length FROM key_value WHERE key = ?
        )
        SELECT value_length,
          CASE WHEN value_length <= ${SQLiteStorage.INLINE_READ_BYTES}
            THEN CASE WHEN instr(value, char(0)) = 0 THEN value ELSE hex(CAST(value AS BLOB)) END
            ELSE substr(value, 1, ${SQLiteStorage.MANIFEST_PEEK_LENGTH}) END AS value,
          CASE WHEN value_length <= ${SQLiteStorage.INLINE_READ_BYTES}
            THEN CASE WHEN instr(value, char(0)) = 0 THEN 'complete' ELSE 'hex' END
            ELSE 'prefix' END AS value_kind
        FROM stored;
      `,
      [key]
    )
    const row = result.values?.[0] as { value?: unknown; value_length?: unknown; value_kind?: unknown } | undefined
    if (!row || typeof row.value !== 'string') return null
    const byteLength = this.toByteLength(row.value_length)
    if (byteLength === null || !Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new Error('Stored value length is invalid')
    }
    if (row.value_kind === 'hex') {
      return { kind: 'complete', value: new TextDecoder('utf-8').decode(this.decodeHex(row.value)) }
    }
    if (row.value_kind === 'complete') return { kind: 'complete', value: row.value }
    if (row.value_kind === 'prefix') return { kind: 'prefix', value: row.value, byteLength }
    throw new Error('Stored value read kind is invalid')
  }

  private async readValueSlice(key: string, start: number, length: number): Promise<string | null> {
    const result = await this.database.query(
      `
        SELECT substr(value, ?, ?) AS value
        FROM key_value
        WHERE key = ?;
      `,
      [start, length, key]
    )
    const value = result.values?.[0]?.value
    return typeof value === 'string' ? value : null
  }

  private async readLegacyBlobValue(key: string, byteLength: number): Promise<string> {
    const decoder = new TextDecoder('utf-8')
    const parts: string[] = []
    for (let offset = 1; offset <= byteLength; offset += SQLiteStorage.BLOB_SLICE_SIZE) {
      const result = await this.database.query(
        `
          SELECT hex(substr(CAST(value AS BLOB), ?, ?)) AS value
          FROM key_value
          WHERE key = ?;
        `,
        [offset, SQLiteStorage.BLOB_SLICE_SIZE, key]
      )
      const hex = result.values?.[0]?.value
      if (typeof hex !== 'string') throw new Error(`Stored value disappeared while reading key "${key}"`)
      parts.push(decoder.decode(this.decodeHex(hex), { stream: true }))
    }
    parts.push(decoder.decode())
    return parts.join('')
  }

  private async readChunkedValue(
    key: string,
    manifest: { generation: string; chunkCount: number; length: number }
  ): Promise<string> {
    const chunks: string[] = []
    for (let index = 0; index < manifest.chunkCount; index++) {
      const result = await this.database.query(
        `
          SELECT CASE WHEN instr(value, char(0)) = 0 THEN value
            ELSE hex(substr(CAST(value AS BLOB), 1, ${SQLiteStorage.BLOB_SLICE_SIZE})) END AS value,
            instr(value, char(0)) > 0 AS contains_nul,
            length(CAST(value AS BLOB)) AS byte_length
          FROM key_value_chunks
          WHERE key = ? AND generation = ? AND chunk_index = ?;
        `,
        [key, manifest.generation, index]
      )
      const row = result.values?.[0]
      const value = row?.value
      if (typeof value !== 'string') throw new Error(`Stored value chunk is missing for key "${key}"`)
      if (!row?.contains_nul) {
        chunks.push(value)
        continue
      }
      const byteLength = row.byte_length
      if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new Error('Stored value chunk length is invalid')
      const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
      chunks.push(decoder.decode(this.decodeHex(value), { stream: true }))
      for (
        let offset = SQLiteStorage.BLOB_SLICE_SIZE + 1;
        offset <= byteLength;
        offset += SQLiteStorage.BLOB_SLICE_SIZE
      ) {
        const slice = await this.database.query(
          'SELECT hex(substr(CAST(value AS BLOB), ?, ?)) AS value FROM key_value_chunks WHERE key = ? AND generation = ? AND chunk_index = ?',
          [offset, SQLiteStorage.BLOB_SLICE_SIZE, key, manifest.generation, index]
        )
        const hex = slice.values?.[0]?.value
        if (typeof hex !== 'string') throw new Error(`Stored value chunk is missing for key "${key}"`)
        chunks.push(decoder.decode(this.decodeHex(hex), { stream: true }))
      }
      chunks.push(decoder.decode())
    }
    return chunks.join('')
  }

  private async cleanupChunks(key: string, generation?: string): Promise<void> {
    if (generation) {
      await this.database.run(
        `
          DELETE FROM key_value_chunks
          WHERE key = ? AND generation <> ?;
        `,
        [key, generation]
      )
      return
    }
    await this.database.run(
      `
        DELETE FROM key_value_chunks
        WHERE key = ?;
      `,
      [key]
    )
  }

  private async cleanupUnreferencedChunks(): Promise<void> {
    const result = await this.database.query(`SELECT DISTINCT key FROM key_value_chunks;`)
    const keys = result.values?.map((row) => String(row.key)) ?? []
    for (const key of keys) {
      const prefix = await this.readValueSlice(key, 1, SQLiteStorage.MANIFEST_PEEK_LENGTH)
      const manifest = this.parseChunkManifest(prefix)
      if (manifest) await this.cleanupChunks(key, manifest.generation)
      else await this.cleanupChunks(key)
    }
  }

  private async enqueueOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueues.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.operationQueues.set(key, current)
    try {
      return await current
    } finally {
      if (this.operationQueues.get(key) === current) this.operationQueues.delete(key)
    }
  }

  private async writeItem(key: string, value: string): Promise<void> {
    try {
      if (value.length <= SQLiteStorage.BRIDGE_CHUNK_SIZE) {
        await this.database.run(
          `
            INSERT OR REPLACE INTO key_value (key, value)
            VALUES (?, ?);
          `,
          [key, value]
        )
        await this.cleanupChunks(key)
        return
      }

      const chunks = this.splitValue(value)
      const generation = uuidv4()
      try {
        for (let index = 0; index < chunks.length; index += SQLiteStorage.CHUNKS_PER_WRITE) {
          const batch = chunks.slice(index, index + SQLiteStorage.CHUNKS_PER_WRITE).map((chunk, batchIndex) => ({
            statement: `
                INSERT INTO key_value_chunks (key, generation, chunk_index, value)
                VALUES (?, ?, ?, ?);
              `,
            values: [key, generation, index + batchIndex, chunk],
          }))
          await this.database.executeSet(batch, true)
        }
        await this.database.run(
          `
            INSERT OR REPLACE INTO key_value (key, value)
            VALUES (?, ?);
          `,
          [key, this.createChunkManifest(generation, chunks.length, value.length)]
        )
      } catch (error) {
        await this.database
          .run(
            `
              DELETE FROM key_value_chunks
              WHERE key = ? AND generation = ?;
            `,
            [key, generation]
          )
          .catch(() => undefined)
        throw error
      }
      await this.cleanupChunks(key, generation)
    } catch (error) {
      console.error('Failed to set value', error)
      throw error
    }
  }

  /** Returns unused database pages to the file system when enough space can be reclaimed. */
  async compact(): Promise<void> {
    await this.ensureInitialized()
    const pragma = async (name: string) => {
      const row = (await this.database.query(`PRAGMA ${name};`)).values?.[0] as Record<string, unknown> | undefined
      return Number(row?.[name])
    }
    const [pageCount, freePages, pageSize] = [
      await pragma('page_count'),
      await pragma('freelist_count'),
      await pragma('page_size'),
    ]
    if (
      !(freePages * pageSize >= SQLiteStorage.COMPACT_MIN_FREE_BYTES) ||
      !(freePages >= pageCount * SQLiteStorage.COMPACT_MIN_FREE_RATIO)
    )
      return
    // The mobile SQLite builds keep temporary databases in memory by default, and VACUUM copies the
    // whole database into one; a file keeps that copy out of the app's memory.
    await this.database.execute('PRAGMA temp_store = FILE;', false)
    try {
      await this.database.execute('VACUUM;', false)
    } finally {
      await this.database.execute('PRAGMA temp_store = DEFAULT;', false)
    }
  }

  async copyItem(source: string, destination: string): Promise<boolean> {
    await this.ensureInitialized()
    const copy = async () => {
      const result = await this.database.query('SELECT 1 AS present FROM key_value WHERE key = ?', [source])
      if (!result.values?.length) return false
      if (source === destination) return true
      await this.database.executeSet(
        [
          { statement: 'DELETE FROM key_value_chunks WHERE key = ?', values: [destination] },
          {
            statement:
              'INSERT INTO key_value_chunks(key,generation,chunk_index,value) SELECT ?,generation,chunk_index,value FROM key_value_chunks WHERE key = ?',
            values: [destination, source],
          },
          {
            statement: 'INSERT OR REPLACE INTO key_value(key,value) SELECT ?,value FROM key_value WHERE key = ?',
            values: [destination, source],
          },
        ],
        true
      )
      return true
    }
    const [first, second] = [source, destination].sort()
    return this.enqueueOperation(first, () => (first === second ? copy() : this.enqueueOperation(second, copy)))
  }

  /** Removes several keys and their chunks in one transaction, holding every key's operation queue. */
  async removeItems(keys: string[]): Promise<void> {
    await this.ensureInitialized()
    const ordered = [...new Set(keys)].sort()
    if (ordered.length === 0) return
    const remove = () =>
      this.database.executeSet(
        ordered.flatMap((key) => [
          { statement: 'DELETE FROM key_value WHERE key = ?;', values: [key] },
          { statement: 'DELETE FROM key_value_chunks WHERE key = ?;', values: [key] },
        ]),
        true
      )
    const acquire = (index: number): Promise<unknown> =>
      this.enqueueOperation(ordered[index], () => (index + 1 < ordered.length ? acquire(index + 1) : remove()))
    await acquire(0)
  }

  // 插入或更新数据
  async setItem(key: string, value: string): Promise<void> {
    if (typeof value !== 'string') {
      // Fail with a diagnosable error instead of the opaque `undefined.length`
      // TypeError inside the chunked writer (issue 1125).
      throw new TypeError(
        `SQLiteStorage.setItem expects a string value, got ${typeof value} for key "${sanitizeStoreKeyForDiagnostics(key)}"`
      )
    }
    await this.ensureInitialized()
    await this.enqueueOperation(key, () => this.writeItem(key, value))
  }

  // 获取值
  async getItem(key: string): Promise<string | null> {
    await this.ensureInitialized()

    return await this.enqueueOperation(key, async () => {
      try {
        const head = await this.readValueHead(key)
        if (head === null) return null
        const manifest = this.parseChunkManifest(head.value)
        if (manifest) return await this.readChunkedValue(key, manifest)
        if (head.kind === 'complete') return head.value
        const blobLength = head.byteLength
        if (blobLength <= SQLiteStorage.BRIDGE_CHUNK_SIZE) {
          return await this.readValueSlice(key, 1, SQLiteStorage.BRIDGE_CHUNK_SIZE)
        }
        const legacyValue = await this.readLegacyBlobValue(key, blobLength)
        void this.enqueueOperation(key, () =>
          this.writeItem(key, legacyValue).catch((error) => {
            console.error('Failed to migrate legacy value', error)
          })
        )
        return legacyValue
      } catch (error) {
        console.error('Failed to get value', error)
        throw error
      }
    })
  }

  // 删除值
  async removeItem(key: string): Promise<void> {
    await this.ensureInitialized()

    await this.enqueueOperation(key, async () => {
      try {
        await this.database.run(
          `
            DELETE FROM key_value
            WHERE key = ?;
          `,
          [key]
        )
        await this.cleanupChunks(key)
      } catch (error) {
        console.error('Failed to delete value', error)
        throw error
      }
    })
  }

  // 获取所有键值对
  async getAllItems(): Promise<{ [key: string]: any }> {
    await this.ensureInitialized()

    try {
      const keyValueObject: { [key: string]: any } = {}
      for (const key of await this.getAllKeys()) {
        const value = await this.getItem(key)
        if (value !== null) keyValueObject[key] = value
      }
      return keyValueObject
    } catch (error) {
      console.error('Failed to get all values', error)
      throw error
    }
  }

  // 获取所有键
  async getAllKeys(): Promise<string[]> {
    await this.ensureInitialized()

    try {
      const query = `
            SELECT key FROM key_value;
          `
      const result = await this.database.query(query)
      // 提取所有key
      const keys: string[] = []
      if (result.values && result.values.length > 0) {
        result.values.forEach((row) => {
          keys.push(row.key)
        })
      }
      return keys
    } catch (error) {
      console.error('Failed to get all keys', error)
      throw error
    }
  }

  // 关闭数据库
  async closeDatabase(): Promise<void> {
    await this.ensureInitialized()

    if (this.database) {
      await this.database.close()
    }
  }
}

export const __test__ = {
  SQLiteStorage,
  sanitizeStoreKeyForDiagnostics,
}

export class MobileSQLiteStorage implements Storage {
  // Native connections are keyed by database name across all wrappers. Migration
  // probes and the platform must share initialization and per-key operation queues.
  private static sharedStorage: SQLiteStorage | undefined

  public getStorageType(): string {
    return 'MOBILE_SQLITE'
  }
  private sqliteStorage: SQLiteStorage

  constructor(database?: SQLiteDBConnection) {
    if (database) {
      this.sqliteStorage = new SQLiteStorage(database)
    } else {
      MobileSQLiteStorage.sharedStorage ??= new SQLiteStorage()
      this.sqliteStorage = MobileSQLiteStorage.sharedStorage
    }
  }

  public copyStoreValue(source: string, destination: string) {
    return this.sqliteStorage.copyItem(source, destination)
  }

  public compactStore() {
    return this.sqliteStorage.compact()
  }

  public delStoreValues(keys: string[]) {
    return this.sqliteStorage.removeItems(keys)
  }
  public async setStoreValue(key: string, value: any) {
    await this.sqliteStorage.setItem(key, serializeStoreValue(this.getStorageType(), key, value))
  }
  public async getStoreValue(key: string) {
    const json = await this.sqliteStorage.getItem(key)
    return json ? JSON.parse(json) : null
  }
  public async delStoreValue(key: string) {
    await this.sqliteStorage.removeItem(key)
  }
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const items = await this.sqliteStorage.getAllItems()
    for (const key in items) {
      if (items[key] && typeof items[key] === 'string') {
        try {
          items[key] = JSON.parse(items[key])
        } catch (error) {
          console.error(`Failed to parse stored value for key "${key}":`, error)
        }
      }
    }
    return items
  }
  public async getAllStoreKeys(): Promise<string[]> {
    return this.sqliteStorage.getAllKeys()
  }
  public async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.setStoreValue(key, value)
    }
  }
}

export class IndexedDBStorage implements Storage {
  private store = localforage.createInstance({ name: 'chatboxstore' })

  public getStorageType(): string {
    return 'INDEXEDDB'
  }

  public async setStoreValue(key: string, value: any) {
    // 为什么序列化成 JSON？
    // 因为 IndexedDB 作为底层驱动时，可以直接存储对象，但是如果对象中包含函数或引用，将会直接报错
    try {
      await this.store.setItem(key, serializeStoreValue(this.getStorageType(), key, value))
    } catch (error) {
      throw new Error(`Failed to store value for key "${key}": ${(error as Error).message}`)
    }
  }
  public async getStoreValue(key: string) {
    const json = await this.store.getItem<string>(key)
    if (!json) return null
    try {
      return JSON.parse(json)
    } catch (error) {
      console.error(`Failed to parse stored value for key "${key}":`, error)
      return null
    }
  }
  public async delStoreValue(key: string) {
    return await this.store.removeItem(key)
  }
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const ret: { [key: string]: any } = {}
    await this.store.iterate((json, key) => {
      if (typeof json === 'string') {
        try {
          ret[key] = JSON.parse(json)
        } catch (error) {
          console.error(`Failed to parse value for key "${key}":`, error)
          ret[key] = null
        }
      } else {
        ret[key] = null
      }
    })
    return ret
  }
  public async getAllStoreKeys(): Promise<string[]> {
    return this.store.keys()
  }
  public async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.setStoreValue(key, value)
    }
  }
}

export function getOldVersionStorages(): Storage[] {
  if (platform.type === 'desktop') {
    return [new DesktopFileStorage()]
  } else if (platform.type === 'mobile') {
    return [new IndexedDBStorage(), new MobileSQLiteStorage(), new LocalStorage()]
  }
  return [new LocalStorage()]
}
