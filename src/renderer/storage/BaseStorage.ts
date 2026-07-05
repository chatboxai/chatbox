import { getLogger } from '@/lib/utils'
import platform from '@/platform'

const log = getLogger('base-storage')

export default class BaseStorage {
  constructor() {}

  public getStorageType() {
    return platform.getStorageType()
  }

  public async setItem<T>(key: string, value: T): Promise<void> {
    return this.setItemNow(key, value)
  }

  public async setItemNow<T>(key: string, value: T): Promise<void> {
    try {
      if (key === 'settings') {
        const valueObj = value as Record<string, unknown>
        const providers = valueObj?.providers
        const providersCount =
          providers && typeof providers === 'object' && !Array.isArray(providers) ? Object.keys(providers).length : 0
        if (providersCount === 0) {
          log.info(
            `[CONFIG_DEBUG] setItemNow settings with providersCount=0, stack=${new Error().stack?.split('\n').slice(1, 6).join(' <- ')}`
          )
        }
      }
      return await platform.setStoreValue(key, value)
    } catch (error) {
      log.error(`Failed to write to storage (key: ${key}):`, error)
      throw error
    }
  }

  public async getItem<T>(key: string, initialValue: T): Promise<T> {
    try {
      let value: unknown = await platform.getStoreValue(key)
      if (value === undefined || value === null) {
        value = initialValue
        if (key === 'settings') {
          log.info(`[CONFIG_DEBUG] getItem settings: value was null/undefined, using initialValue`)
        }
        void this.setItemNow(key, value)
      } else if (key === 'settings') {
        const providers = (value as Record<string, unknown>)?.providers
        const providersCount =
          providers && typeof providers === 'object' && !Array.isArray(providers) ? Object.keys(providers).length : 0
        if (providersCount === 0) {
          log.info(`[CONFIG_DEBUG] getItem settings: read providersCount=0 from storage`)
        }
      }
      return value as T
    } catch (error) {
      log.error(`Failed to read from storage (key: ${key}):`, error)
      throw error
    }
  }

  public async removeItem(key: string): Promise<void> {
    return platform.delStoreValue(key)
  }

  public async getAll(): Promise<{ [key: string]: any }> {
    try {
      return await platform.getAllStoreValues()
    } catch (error) {
      log.error('Failed to read all values from storage:', error)
      throw error
    }
  }

  public async getAllKeys(): Promise<string[]> {
    try {
      return await platform.getAllStoreKeys()
    } catch (error) {
      log.error('Failed to read all keys from storage:', error)
      throw error
    }
  }

  public async setAll(data: { [key: string]: any }) {
    return platform.setAllStoreValues(data)
  }

  // TODO: Blob 数据也应纳入导出/导入，至少包含：
  // - `picture:*` 图片附件内容
  // - `file:*` / `file:<name>-<size>-<mtime>` 文件解析内容与缓存文本
  // - `link:*` 网页解析内容缓存
  // - 与附件/链接相关的 `*_tokenMap` 统计键（用于恢复 token 预估与预览元数据）
  public async setBlob(key: string, value: string) {
    return platform.setStoreBlob(key, value)
  }
  public async getBlob(key: string): Promise<string | null> {
    try {
      return await platform.getStoreBlob(key)
    } catch (error) {
      log.error(`Failed to read blob from storage (key: ${key}):`, error)
      throw error
    }
  }
  public async delBlob(key: string) {
    return platform.delStoreBlob(key)
  }
  public async getBlobKeys(): Promise<string[]> {
    return platform.listStoreBlobKeys()
  }
  // subscribe(key: string, callback: any, initialValue: any): Promise<void>
}
