import type { Session } from '@shared/types'
import { v4 as uuid } from 'uuid'
import { isRowsSessionRecord, type SessionRecordStorePort } from '../ports'
import type { SessionRowStorePort } from '../ports/session-row-store'
import { stageLegacySessionRows } from './legacy-row-import'
import type { SessionRecordV2 } from '../session/session-tree'
import { throwIfAborted } from './abort'
import { type LegacyBackupSource, legacyBackupSource } from './legacy-source'
import type { BackupSessionStore } from './session-port'

export interface BackupRecordSnapshots {
  stage(token: string, session: Session): Promise<void>
  capture(id: string, token: string): Promise<boolean>
  restore(id: string, token: string, existed: boolean): Promise<void>
  remove(token: string): Promise<void>
}

/** Published row commits remain authoritative even when the external record projection is stale. */
export function recordBackupSource(
  rows: BackupSessionStore & Pick<SessionRowStorePort, 'readCommit'>,
  records: SessionRecordStorePort,
  legacy: LegacyBackupSource
): BackupSessionStore {
  const source = legacyBackupSource(
    {
      listSessionIds: async () => [],
      iterateBackupRows: rows.iterateBackupRows.bind(rows),
      beginBackupRestore: rows.beginBackupRestore.bind(rows),
    },
    legacy
  )
  const published = async (id: string) => {
    const commit = await rows.readCommit(id)
    if (commit?.record.rowAuthority === 1) return true
    if (legacy.open) return false
    const record = await records.getRecord(id)
    if (record && isRowsSessionRecord(record)) {
      if (!commit) throw new Error(`Published rows are missing for ${id}`)
      return true
    }
    return false
  }
  return {
    beginBackupRestore: rows.beginBackupRestore.bind(rows),
    listSessionIds: async () => {
      const [rowIds, recordIds] = await Promise.all([rows.listSessionIds(), records.listIds()])
      return [...new Set([...rowIds, ...recordIds])]
    },
    async *iterateBackupRows(id, limits, signal, threadId) {
      if (await published(id)) yield* rows.iterateBackupRows(id, limits, signal, threadId)
      else yield* source.iterateBackupRows(id, limits, signal, threadId)
    },
    readLegacySession: async (id, maxBytes, signal) =>
      (await published(id)) ? null : source.readLegacySession!(id, maxBytes, signal),
  }
}

/** Publishes the row head and the repository's key-value marker under the backup lock. */
export function createRecordBackupSessionStore(
  rows: BackupSessionStore & Pick<SessionRowStorePort, 'readCommit'>,
  records: SessionRecordStorePort,
  snapshots: BackupRecordSnapshots,
  legacy: LegacyBackupSource,
  createId: () => string = uuid
): BackupSessionStore {
  return {
    ...recordBackupSource(rows, records, legacy),
    async beginLegacyRestore(session) {
      return stageLegacySessionRows(this, session)
    },
    async beginBackupRestore(id, expectedRevision) {
      const token = `__chatbox_backup_import:record:${createId()}`
      const existed = await snapshots.capture(id, token)
      let candidate: Awaited<ReturnType<typeof rows.beginBackupRestore>>
      try {
        candidate = await rows.beginBackupRestore(id, expectedRevision)
      } catch (error) {
        await snapshots.remove(token)
        throw error
      }
      let header: SessionRecordV2 | undefined
      let markerWritten = false
      let rollbackFailed = false
      return {
        appendPayload: candidate.appendPayload?.bind(candidate),
        flush: candidate.flush?.bind(candidate),
        async append(row) {
          await candidate.append(row)
          if (row.kind === 'header') header = row.record
        },
        async publish(signal) {
          if (!header) throw new Error('Backup session header is missing')
          throwIfAborted(signal)
          await candidate.publish(signal)
          markerWritten = true
          const {
            forkCreatedAt: _forks,
            presentation: _presentation,
            contextReadProjection: _context,
            topologyFingerprint: _fingerprint,
            ...canonical
          } = header
          await records.setRecord({ ...canonical, rowFormatVersion: 3, rowAuthority: 1 })
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
