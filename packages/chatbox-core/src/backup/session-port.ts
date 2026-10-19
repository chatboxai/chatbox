import type { Message, Session } from '@shared/types'
import type { MessageRow, SessionRecordV2, ThreadRow } from '../session/session-tree/types'

export interface BackupPageLimits {
  maxPageRows: number
  maxPageBytes: number
  maxRecordBytes: number
}
export const DEFAULT_BACKUP_PAGE_LIMITS: BackupPageLimits = {
  maxPageRows: 128,
  maxPageBytes: 512 * 1024,
  maxRecordBytes: 128 * 1024,
}
export function backupPageLimits(limits?: Partial<BackupPageLimits>): BackupPageLimits {
  const result = { ...DEFAULT_BACKUP_PAGE_LIMITS, ...limits }
  for (const key of ['maxPageRows', 'maxPageBytes', 'maxRecordBytes'] as const) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 1 || result[key] > DEFAULT_BACKUP_PAGE_LIMITS[key]) {
      throw new Error(`Invalid backup budget: ${key}`)
    }
  }
  if (result.maxRecordBytes + 2 > result.maxPageBytes) throw new Error('Backup record budget exceeds page budget')
  return result
}

/** Storage-neutral port; physical revisions and caches never cross the archive boundary. */
export type BackupRow =
  | { kind: 'header'; record: SessionRecordV2 }
  | { kind: 'thread'; thread: ThreadRow }
  // With a payload, message.message is a validation projection; chunks carry the complete JSON value.
  // original() returns the validated projection of those chunks once they have been fully consumed;
  // value is the complete parsed message when the payload was small enough to materialize.
  | {
      kind: 'message'
      message: MessageRow
      payload?: {
        size?: number
        chunks?: () => AsyncIterable<Uint8Array>
        original?: () => Message
        value?: Message
      }
    }

export interface BackupSessionCandidate {
  appendPayload?(chunk: Uint8Array): Promise<void>
  append(row: BackupRow): Promise<void>
  /** Persist buffered staging data before switching sessions, without publishing it. */
  flush?(): Promise<void>
  publish(signal?: AbortSignal): Promise<void>
  rollback(): Promise<void>
  dispose(): Promise<void>
}
export interface BackupSessionStore {
  listSessionIds(): Promise<string[]>
  /** External legacy JSON decoding is bounded by the caller-provided byte limit. */
  readLegacySession?(sessionId: string, maxBytes: number, signal?: AbortSignal): Promise<Session | null>
  beginLegacyRestore?(session: Session): Promise<BackupSessionCandidate>
  iterateBackupRows(
    sessionId: string,
    limits: BackupPageLimits,
    signal?: AbortSignal,
    threadId?: string
  ): AsyncIterable<BackupRow>
  beginBackupRestore(sessionId: string, expectedRevision?: number | null): Promise<BackupSessionCandidate>
}
