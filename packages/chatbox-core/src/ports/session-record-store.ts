import type { Session } from '../types/session'

/** A session record as it sits in storage: a whole V1 `Session`. */
export type StoredSessionRecord = Session

/**
 * Whole-session records, addressed by session id: the input of row migration.
 * A migrated record is never rewritten, because older app versions keep reading
 * it after a downgrade; the row store's head commit is authoritative instead.
 * Deleting a session removes its record too.
 */
export interface SessionRecordStorePort {
  initialize(): Promise<void>
  getRecord(id: string): Promise<StoredSessionRecord | null>
  setRecord(record: StoredSessionRecord): Promise<void>
  removeRecord(id: string): Promise<void>
  listIds(): Promise<string[]>
}
