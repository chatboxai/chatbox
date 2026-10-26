import type { SessionRecordV2 } from '../session/session-tree/types'
import type { Session } from '../types/session'

/**
 * A session record as it sits in storage: either a whole V1 `Session`, or the
 * row-backed record whose messages, threads and forks live in the row store.
 */
export type StoredSessionRecord = Session | SessionRecordV2

export function isRowsSessionRecord(record: StoredSessionRecord): record is SessionRecordV2 {
  return (record as Partial<SessionRecordV2>).storageFormat === 'rows'
}

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
