import type { DebouncedFunc } from 'lodash'
import debounce from 'lodash/debounce'
import { v4 as uuidv4 } from 'uuid'
import BaseStorage, { type StorageReadOptions } from './BaseStorage'
import { getFileUniqKey } from './file-uniq-key'

export enum StorageKey {
  ChatSessions = 'chat-sessions',
  Configs = 'configs',
  Settings = 'settings',
  MyCopilots = 'myCopilots',
  ConfigVersion = 'configVersion',
  RemoteConfig = 'remoteConfig',
  ChatSessionsList = 'chat-sessions-list',
  ChatSessionSettings = 'chat-session-settings',
  PictureSessionSettings = 'picture-session-settings',
  AuthInfo = 'authInfo',
}

export const StorageKeyGenerator = {
  session(id: string) {
    return `session:${id}`
  },
  picture(category: string) {
    return `picture:${category}:${uuidv4()}`
  },
  file(sessionId: string, msgId: string) {
    return `file:${sessionId}:${msgId}:${uuidv4()}`
  },
  fileUniqKey(file: File) {
    return getFileUniqKey(file)
  },
  linkUniqKey(url: string) {
    return `link:${url}`
  },
}

export default class StoreStorage extends BaseStorage {
  public async getItem<T>(key: string, initialValue: T, options: StorageReadOptions = {}): Promise<T> {
    const value: T = await super.getItem(key, initialValue, options)

    if (key === StorageKey.Configs && value === initialValue) {
      await super.setItemNow(key, initialValue) // 持久化初始生成的 uuid
    }

    return value
  }

  private debounceQueue = new Map<string, DebouncedFunc<(key: string, value: unknown) => Promise<void>>>()
  private pendingWrites = new Set<Promise<void>>()

  public async setItem<T>(key: string, value: T): Promise<void> {
    let debounced = this.debounceQueue.get(key)
    if (!debounced) {
      debounced = debounce(
        (key: string, value: unknown) => {
          const pending = this.setItemNow(key, value)
          this.pendingWrites.add(pending)
          const settled = () => {
            this.pendingWrites.delete(pending)
          }
          pending.then(settled, settled)
          return pending
        },
        500,
        { maxWait: 2000 }
      )
      this.debounceQueue.set(key, debounced)
    }
    debounced(key, value)
  }

  /** Includes both delayed writes and writes whose storage call has already started. */
  public async flushPendingWrites(): Promise<void> {
    for (const debounced of this.debounceQueue.values()) debounced.flush()
    const results = await Promise.allSettled(this.pendingWrites)
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }
}
