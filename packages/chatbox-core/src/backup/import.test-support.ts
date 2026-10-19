import type { Session } from '../types/session'
import { InMemorySessionRowStore } from '../persistence/memory-session-row-store'
import { decodeSessionTree } from '../session/session-tree'
import { importBackupArchive, type BackupImportOptions } from './import-backup'
import { stageLegacySessionRows } from './legacy-row-import'
import type { BackupFile, BackupStorage } from './types'

const targets = new WeakMap<BackupStorage, InMemorySessionRowStore>()

export function importedRows(storage: BackupStorage): InMemorySessionRowStore {
  let rows = targets.get(storage)
  if (!rows) {
    rows = new InMemorySessionRowStore()
    targets.set(storage, rows)
  }
  return rows
}

export function importBackupArchiveWithRows(file: BackupFile, options: BackupImportOptions) {
  return importBackupArchive(file, {
    ...options,
    sharded: options.sharded ?? { store: importedRows(options.storage) },
  })
}

export async function seedImportedSession(storage: BackupStorage, session: Session): Promise<void> {
  const candidate = await stageLegacySessionRows(importedRows(storage), session)
  await candidate.publish()
  await candidate.dispose()
}

export async function readImportedSession(storage: BackupStorage, sessionId: string): Promise<Session> {
  const snapshot = await importedRows(storage).readSnapshot(sessionId)
  if (!snapshot) throw new Error(`Missing imported row session: ${sessionId}`)
  const decoded = decodeSessionTree({ session: snapshot.record, ...snapshot.rows })
  if (!decoded.ok) throw new Error(decoded.reason)
  return decoded.session
}
