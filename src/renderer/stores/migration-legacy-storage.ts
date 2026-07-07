import type { Storage } from '@/platform/interfaces'

/**
 * 老版本桌面端的存储（config file storage）。仅用于 migrateStorage 的历史数据迁移，
 * 新数据统一存储在 IndexedDB（localforage）中。
 */
export class DesktopFileStorage implements Storage {
  public ipc = window.electronAPI

  public getStorageType(): string {
    return 'DESKTOP_FILE'
  }

  // biome-ignore lint/suspicious/noExplicitAny: the store holds heterogeneous JSON payloads; callers narrow per key
  public async setStoreValue(key: string, value: any) {
    // 为什么要序列化？
    // 为了实现进程通信，electron invoke 会自动对传输数据进行序列化，
    // 但如果数据包含无法被序列化的类型（比如 message 中常带有的 cancel 函数）将直接报错：
    // Uncaught (in promise) Error: An object could not be cloned.
    // 因此对于数据类型不容易控制的场景，应该提前 JSON.stringify，这种序列化方式会自动处理异常类型。
    const valueJson = JSON.stringify(value)
    return this.ipc.invoke('setStoreValue', key, valueJson)
  }
  // biome-ignore lint/suspicious/noExplicitAny: the store holds heterogeneous JSON payloads; callers narrow per key
  public async getStoreValue(key: string) {
    return this.ipc.invoke('getStoreValue', key)
  }
  public delStoreValue(key: string) {
    return this.ipc.invoke('delStoreValue', key)
  }
  // biome-ignore lint/suspicious/noExplicitAny: the store holds heterogeneous JSON payloads; callers narrow per key
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const json = await this.ipc.invoke('getAllStoreValues')
    return JSON.parse(json)
  }
  public async getAllStoreKeys(): Promise<string[]> {
    return this.ipc.invoke('getAllStoreKeys')
  }
  // biome-ignore lint/suspicious/noExplicitAny: the store holds heterogeneous JSON payloads; callers narrow per key
  public async setAllStoreValues(data: { [key: string]: any }) {
    await this.ipc.invoke('setAllStoreValues', JSON.stringify(data))
  }
}

export function getOldVersionStorages(): Storage[] {
  return [new DesktopFileStorage()]
}
