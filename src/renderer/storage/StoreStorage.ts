import type { DebouncedFunc } from 'lodash'
import debounce from 'lodash/debounce'
import { v4 as uuidv4 } from 'uuid'
import { getBestEffortFileNativePath } from '@/utils/file-native-path'
import BaseStorage from './BaseStorage'

const FILE_UNIQ_KEY_PROPERTY = '__chatboxFileUniqKey'

type FileWithRememberedUniqKey = File & {
  [FILE_UNIQ_KEY_PROPERTY]?: string
}

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
  SessionFolders = 'session-folders',
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
    const fileWithRememberedUniqKey = file as FileWithRememberedUniqKey
    if (fileWithRememberedUniqKey[FILE_UNIQ_KEY_PROPERTY]) {
      return fileWithRememberedUniqKey[FILE_UNIQ_KEY_PROPERTY]
    }

    const uniqKey = `file:${getBestEffortFileNativePath(file) || file.name}-${file.size}-${file.lastModified}`
    Object.defineProperty(file, FILE_UNIQ_KEY_PROPERTY, {
      value: uniqKey,
      configurable: true,
    })
    return uniqKey
  },
  linkUniqKey(url: string) {
    return `link:${url}`
  },
}

export default class StoreStorage extends BaseStorage {
  public async getItem<T>(key: string, initialValue: T): Promise<T> {
    const value: T = await super.getItem(key, initialValue)

    if (key === StorageKey.Configs && value === initialValue) {
      await super.setItemNow(key, initialValue) // 持久化初始生成的 uuid
    }

    return value
  }

  private debounceQueue = new Map<string, DebouncedFunc<(key: string, value: unknown) => void>>()

  public async setItem<T>(key: string, value: T): Promise<void> {
    let debounced = this.debounceQueue.get(key)
    if (!debounced) {
      debounced = debounce(this.setItemNow.bind(this), 500, { maxWait: 2000 })
      this.debounceQueue.set(key, debounced)
    }
    debounced(key, value)
  }
}
