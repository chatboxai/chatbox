import type { SessionRecordV2, ThreadRow, MessageRow } from '../session/session-tree/types'

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
  | { kind: 'message'; message: MessageRow }

export interface BackupSessionCandidate {
  append(row: BackupRow): Promise<void>
  publish(): Promise<void>
  rollback(): Promise<void>
  dispose(): Promise<void>
}
export interface BackupSessionStore {
  listSessionIds(): Promise<string[]>
  iterateBackupRows(sessionId: string, limits: BackupPageLimits, signal?: AbortSignal): AsyncIterable<BackupRow>
  beginBackupRestore(sessionId: string): Promise<BackupSessionCandidate>
}
