import type { Session } from '@shared/types'
import { v4 as uuid } from 'uuid'
import { isRowsSessionRecord, type SessionRecordStorePort } from '../ports'
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

/** 备份与附件归属扫描共用权威来源，避免覆盖导入后把残留旧行当成当前消息。 */
export function recordBackupSource(
  rows: BackupSessionStore,
  records: SessionRecordStorePort,
  legacy: LegacyBackupSource
): BackupSessionStore {
  // 完整旧记录在迁移提交前始终是权威来源；恢复旧 JSON 后可能仍留有用于回滚的旧行。
  const source = legacyBackupSource(
    {
      listSessionIds: async () => [],
      iterateBackupRows: rows.iterateBackupRows.bind(rows),
      beginBackupRestore: rows.beginBackupRestore.bind(rows),
    },
    legacy
  )
  return {
    beginBackupRestore: rows.beginBackupRestore.bind(rows),
    listSessionIds: () => records.listIds(),
    async *iterateBackupRows(id, limits, signal) {
      // 没有行数据的旧对话直接走有界扫描，避免为判断格式先整段读取大 JSON。
      if (!(await rows.listSessionIds()).includes(id)) {
        yield* source.iterateBackupRows(id, limits, signal)
        return
      }
      const record = await records.getRecord(id)
      if (record && !isRowsSessionRecord(record)) yield* source.iterateBackupRows(id, limits, signal)
      else yield* rows.iterateBackupRows(id, limits, signal)
    },
    readLegacySession: async (id, maxBytes, signal) => {
      if ((await rows.listSessionIds()).includes(id)) {
        const record = await records.getRecord(id)
        if (!record || isRowsSessionRecord(record)) return null
      }
      return source.readLegacySession!(id, maxBytes, signal)
    },
  }
}

/** Publishes the row head and the repository's key-value marker under the backup lock. */
export function createRecordBackupSessionStore(
  rows: BackupSessionStore,
  records: SessionRecordStorePort,
  snapshots: BackupRecordSnapshots,
  legacy: LegacyBackupSource,
  createId: () => string = uuid
): BackupSessionStore {
  return {
    ...recordBackupSource(rows, records, legacy),
    async beginLegacyRestore(session) {
      const token = `__chatbox_backup_import:record:${createId()}`
      const id = session.id
      const staged = `${token}:staged`
      const existed = await snapshots.capture(id, token)
      try {
        // 候选旧 JSON 落到临时存储，不能把每个待恢复对话都留在内存中直到整包提交。
        await snapshots.stage(staged, session)
      } catch (error) {
        await snapshots.remove(staged)
        await snapshots.remove(token)
        throw error
      }
      let written = false
      let rollbackFailed = false
      return {
        async append() {
          throw new Error('Legacy restore does not accept message rows')
        },
        async publish(signal) {
          throwIfAborted(signal)
          written = true
          await snapshots.restore(id, staged, true)
          throwIfAborted(signal)
        },
        async rollback() {
          if (!written) return
          try {
            await snapshots.restore(id, token, existed)
            written = false
          } catch (error) {
            rollbackFailed = true
            throw new Error(`Backup session rollback failed; recovery record retained (${token})`, { cause: error })
          }
        },
        async dispose() {
          if (rollbackFailed) throw new Error(`Backup recovery record retained (${token})`)
          await snapshots.remove(staged)
          await snapshots.remove(token)
        },
      }
    },
    async beginBackupRestore(id) {
      const token = `__chatbox_backup_import:record:${createId()}`
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
