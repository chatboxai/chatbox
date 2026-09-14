import {
  legacyBackupSource,
  type BackupSessionStore,
  type LegacyBackupSource,
  throwIfAborted,
} from '@chatbox/core/backup'
import type { SessionRecordStorePort } from '@chatbox/core/ports'
import type { SessionRecordV2 } from '@chatbox/core/session/session-tree'
import { v4 as uuid } from 'uuid'

export interface BackupRecordSnapshots {
  capture(id: string, token: string): Promise<boolean>
  restore(id: string, token: string, existed: boolean): Promise<void>
  remove(token: string): Promise<void>
}

/** Publishes the row head and the repository's key-value marker under the backup lock. */
export function rendererBackupSessionStore(
  rows: BackupSessionStore,
  records: SessionRecordStorePort,
  snapshots: BackupRecordSnapshots,
  legacy: LegacyBackupSource
): BackupSessionStore {
  const source = legacyBackupSource(rows, legacy)
  return {
    listSessionIds: () => records.listIds(),
    iterateBackupRows: (id, limits, signal) => source.iterateBackupRows(id, limits, signal),
    async beginBackupRestore(id) {
      const token = `__chatbox_backup_import:record:${uuid()}`
      const existed = await snapshots.capture(id, token)
      let candidate: Awaited<ReturnType<typeof rows.beginBackupRestore>>
      try {
        candidate = await rows.beginBackupRestore(id)
      } catch (error) {
        await snapshots.remove(token)
        throw error
      }
      let header: SessionRecordV2 | undefined
      let markerWritten = false
      let rollbackFailed = false
      return {
        appendPayload: candidate.appendPayload?.bind(candidate),
        async append(row) {
          await candidate.append(row)
          if (row.kind === 'header') header = row.record
        },
        async publish(signal) {
          if (!header) throw new Error('Backup session header is missing')
          throwIfAborted(signal)
          await candidate.publish(signal)
          markerWritten = true
          await records.setRecord(header)
          throwIfAborted(signal)
        },
        async rollback() {
          try {
            await candidate.rollback()
            if (markerWritten) await snapshots.restore(id, token, existed)
            markerWritten = false
          } catch (error) {
            rollbackFailed = true
            throw new Error(`Backup session rollback failed; recovery record retained (${token})`, { cause: error })
          }
        },
        async dispose() {
          if (rollbackFailed) throw new Error(`Backup recovery record retained (${token})`)
          await candidate.dispose()
          await snapshots.remove(token)
        },
      }
    },
  }
}
