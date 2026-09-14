import type { SessionRecordStorePort, StoredSessionRecord } from '@chatbox/core/ports'
import { StorageKeyGenerator } from '@/storage/StoreStorage'

const SESSION_KEY_PREFIX = 'session:'
/**
 * Ids that never name a stored session: `new` is the sentinel of the chat the
 * user has not created yet, the other two come from malformed keys.
 */
const RESERVED_SESSION_IDS = new Set(['', 'undefined', 'new'])

export interface CurrentSessionDataStorage {
  copyItem?(source: string, destination: string): Promise<boolean>
  openBackupValue?(key: string): Promise<import('@chatbox/core/backup').BackupFile | null>
  getItem<T>(key: string, initialValue: T): Promise<T>
  setItemNow<T>(key: string, value: T): Promise<void>
  removeItem(key: string): Promise<void>
  getAllKeys(): Promise<string[]>
}

/**
 * Session records in the Renderer key-value storage, one per `session:<id>` key.
 *
 * Records are handed out exactly as stored: a legacy whole-session value is not
 * migrated here, because the repository above decides whether that value can be
 * converted into rows.
 */
export class CurrentSessionRecordStore implements SessionRecordStorePort {
  constructor(private readonly storage: CurrentSessionDataStorage) {}

  initialize(): Promise<void> {
    return Promise.resolve()
  }

  getRecord(id: string): Promise<StoredSessionRecord | null> {
    return this.storage.getItem<StoredSessionRecord | null>(StorageKeyGenerator.session(id), null)
  }

  setRecord(record: StoredSessionRecord): Promise<void> {
    return this.storage.setItemNow(StorageKeyGenerator.session(record.id), record)
  }

  removeRecord(id: string): Promise<void> {
    return this.storage.removeItem(StorageKeyGenerator.session(id))
  }

  async listIds(): Promise<string[]> {
    const keys = await this.storage.getAllKeys()
    return keys
      .filter((key) => key.startsWith(SESSION_KEY_PREFIX))
      .map((key) => key.slice(SESSION_KEY_PREFIX.length))
      .filter((id) => !RESERVED_SESSION_IDS.has(id))
  }
}
