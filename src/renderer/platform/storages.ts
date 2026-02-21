import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import localforage from 'localforage'
import { StorageKey } from '@/storage'
import platform from '.'
import type { Storage } from './interfaces'

export class DesktopFileStorage implements Storage {
  public ipc = window.desktopAPI

  public getStorageType(): string {
    return 'DESKTOP_FILE'
  }

  public async setStoreValue(key: string, value: any) {
    // 为什么要序列化？
    // 为了实现进程通信，desktop IPC invoke 会自动对传输数据进行序列化，
    // 但如果数据包含无法被序列化的类型（比如 message 中常带有的 cancel 函数）将直接报错：
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
  private sqlite: SQLiteConnection
  private database!: SQLiteDBConnection
  private initializePromise: Promise<void>

  constructor() {
    this.sqlite = new SQLiteConnection(CapacitorSQLite)
    this.initializePromise = this.initialize() // 初始化 Promise
  }

  // 创建并打开数据库
  private async initialize(): Promise<void> {
    try {
      // reload的时候会报connection already open错误，所以先关闭
      this.sqlite.closeConnection('chatbox.db', false)
      this.database = await this.sqlite.createConnection('chatbox.db', false, 'no-encryption', 1, false)

      // 创建表
      const createTable = `
                CREATE TABLE IF NOT EXISTS key_value (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT
                );
            `
      await this.database.open()
      await this.database.execute(createTable)
    } catch (error) {
      console.error('Failed to initialize database', error)
      throw error
    }
  }

  // 确保数据库初始化完成
  private async ensureInitialized(): Promise<void> {
    await this.initializePromise
  }

  // 插入或更新数据
  async setItem(key: string, value: string): Promise<void> {
    await this.ensureInitialized()

    try {
      const query = `
          INSERT OR REPLACE INTO key_value (key, value)
          VALUES (?, ?);
        `
      await this.database.run(query, [key, value])
    } catch (error) {
      console.error('Failed to set value', error)
      throw error
    }
  }

  // 获取值
  async getItem(key: string): Promise<string | null> {
    await this.ensureInitialized()

    try {
      const query = `
          SELECT value FROM key_value
          WHERE key = ?;
        `
      const result = await this.database.query(query, [key])
      return result.values?.[0]?.value || null
    } catch (error) {
      console.error('Failed to get value', error)
      throw error
    }
  }

  // 删除值
  async removeItem(key: string): Promise<void> {
    await this.ensureInitialized()

    try {
      const query = `
          DELETE FROM key_value
          WHERE key = ?;
        `
      await this.database.run(query, [key])
    } catch (error) {
      console.error('Failed to delete value', error)
      throw error
    }
  }

  // 获取所有键值对
  async getAllItems(): Promise<{ [key: string]: any }> {
    await this.ensureInitialized()

    try {
      const query = `
            SELECT * FROM key_value;
          `
      const result = await this.database.query(query)
      // 将结果转换为 { [key: string]: value } 格式
      const keyValueObject: { [key: string]: any } = {}
      if (result.values && result.values.length > 0) {
        result.values.forEach((row) => {
          keyValueObject[row.key] = row.value
        })
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

export class MobileSQLiteStorage implements Storage {
  public getStorageType(): string {
    return 'MOBILE_SQLITE'
  }
  private sqliteStorage = new SQLiteStorage()

  public async setStoreValue(key: string, value: any) {
    await this.sqliteStorage.setItem(key, JSON.stringify(value))
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
      await this.store.setItem(key, JSON.stringify(value))
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
