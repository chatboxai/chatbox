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
 * Session-level records, addressed by session id. Rows of the same session are
 * written separately through `SessionRowStorePort`; the two writes are not one
 * transaction, so promotion keeps a complete V1 record first and writes the
 * compact row marker last.
 */
export interface SessionRecordStorePort {
  initialize(): Promise<void>
  getRecord(id: string): Promise<StoredSessionRecord | null>
  setRecord(record: StoredSessionRecord): Promise<void>
  removeRecord(id: string): Promise<void>
  listIds(): Promise<string[]>
}
