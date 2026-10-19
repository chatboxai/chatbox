import type { Session, SessionMetaRecord } from '@shared/types'
import { SessionMetaRecordSchema } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { migrateSession } from '../application/session/compatibility/session-load'
import { createSessionMetaRecord } from '../application/session/session-metadata'
import { hasPendingPauseInteraction } from '../message-approval'
import { stageLegacySessionRows } from './legacy-row-import'
import type { BackupSessionCandidate, BackupSessionStore } from './session-port'
import { throwIfAborted } from './abort'
import { BackupStorageKey, backupSessionStorageKey } from './storage-keys'
import type { BackupFile, BackupMetaStorage, BackupStorage } from './types'

export interface LegacyBackupDataStore {
  getData<T>(key: string, defaultValue: T): Promise<T>
  setData<T>(key: string, value: T): Promise<void>
  setAll(data: Record<string, unknown>): Promise<void>
  getSession(id: string): Promise<Session | null>
  setSession(session: Session): Promise<void>
}

export interface LegacyBackupImportOptions {
  signal?: AbortSignal
  storage: BackupStorage
  sessions: BackupSessionStore
  metaStorage: BackupMetaStorage
  migrateData: (dataStore: LegacyBackupDataStore) => Promise<void>
  recoverSessionList: () => Promise<void>
}

export interface LegacyBackupImportResult {
  importedKeyCount: number
  importedMetaCount: number
  recoveredSessionList: boolean
}

function normalizeMeta(value: unknown): SessionMetaRecord | undefined {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') return undefined
  const candidate = {
    ...value,
    sortOrder: 'sortOrder' in value && typeof value.sortOrder === 'number' ? value.sortOrder : Date.now(),
    createdAt: 'createdAt' in value && typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
  }
  const parsed = SessionMetaRecordSchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

export async function importLegacyJsonBackup(
  file: BackupFile,
  options: LegacyBackupImportOptions
): Promise<LegacyBackupImportResult> {
  throwIfAborted(options.signal)
  const parsed: unknown = JSON.parse(await file.text())
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Unsupported legacy backup data format')
  }
  throwIfAborted(options.signal)
  const importData = parsed as Record<string, unknown>
  await options.migrateData({
    getData: <T>(key: string, defaultValue: T) => Promise.resolve((importData[key] ?? defaultValue) as T),
    setData: (key, value) => {
      importData[key] = value
      return Promise.resolve()
    },
    setAll: (data) => {
      Object.assign(importData, data)
      return Promise.resolve()
    },
    getSession: (id) => {
      const value = importData[backupSessionStorageKey(id)]
      return Promise.resolve(value && typeof value === 'object' ? migrateSession(value as Session) : null)
    },
    setSession: (session) => {
      importData[backupSessionStorageKey(session.id)] = session
      return Promise.resolve()
    },
  })

  const entriesToImport = Object.entries(importData).filter(
    ([key]) =>
      key !== BackupStorageKey.ChatSessionsList && key !== BackupStorageKey.ConfigVersion && !key.startsWith('__')
  )
  throwIfAborted(options.signal)
  const sessionEntries: Array<[string, Session]> = []
  const valueEntries: Array<[string, unknown]> = []
  for (const [key, value] of entriesToImport) {
    if (!key.startsWith('session:')) {
      valueEntries.push([key, value])
      continue
    }
    const sessionId = key.slice('session:'.length)
    if (!sessionId || !value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Legacy backup session identity mismatch')
    const session = migrateSession(value as Session)
    if (session.id !== sessionId) throw new Error('Legacy backup session identity mismatch')
    sessionEntries.push([key, session])
  }
  const existingKeys = new Set(await options.storage.getAllKeys())
  const previousMeta = await options.metaStorage.getAllIncludingHidden()
  const operationId = uuidv4()
  const snapshots: Array<{ key: string; previousKey?: string }> = []
  const changedKeys: typeof snapshots = []
  let metadataTouched = false
  let committed = false
  let rollbackFailed = false
  const candidates: BackupSessionCandidate[] = []
  const cleanup = async () => {
    for (const { previousKey } of snapshots) {
      if (previousKey) await options.storage.removeItem(previousKey)
    }
  }
  try {
    for (const [, session] of sessionEntries) {
      throwIfAborted(options.signal)
      candidates.push(await stageLegacySessionRows(options.sessions, session, options.signal))
    }
    // Store originals before publishing any record; failed rollback retains them.
    for (const [key] of valueEntries) {
      throwIfAborted(options.signal)
      const previousKey = existingKeys.has(key) ? `__backup_legacy:${operationId}:${snapshots.length}` : undefined
      if (previousKey) await options.storage.setItemNow(previousKey, await options.storage.getItem(key, null))
      snapshots.push({ key, previousKey })
    }
    for (const [index, [key, value]] of valueEntries.entries()) {
      throwIfAborted(options.signal)
      changedKeys.push(snapshots[index])
      await options.storage.setItemNow(key, value)
    }
    throwIfAborted(options.signal)
    for (const candidate of candidates) await candidate.publish(options.signal)
    throwIfAborted(options.signal)
    metadataTouched = true

    const rawMetaValue = importData[BackupStorageKey.ChatSessionsList]
    const rawMeta: unknown[] | undefined = Array.isArray(rawMetaValue) ? rawMetaValue : undefined
    let importedMetaCount = 0
    let recoveredSessionList = false
    if (rawMeta) {
      for (const item of rawMeta) {
        throwIfAborted(options.signal)
        const record = normalizeMeta(item)
        if (!record) continue
        const rawSession = importData[backupSessionStorageKey(record.id)]
        if (rawSession && typeof rawSession === 'object') {
          record.hasPausedToolCall = hasPendingPauseInteraction(migrateSession(rawSession as Session).messages)
        }
        const existing = await options.metaStorage.getById(record.id)
        if (existing) {
          await options.metaStorage.update(record.id, {
            ...record,
            recoveryArchived: record.recoveryArchived,
          })
        } else await options.metaStorage.create(record)
        importedMetaCount++
      }
    } else if (sessionEntries.length) {
      for (const [, session] of sessionEntries) {
        const sessionId = session.id
        throwIfAborted(options.signal)
        const record = createSessionMetaRecord(session, Date.now(), Date.now())
        const existing = await options.metaStorage.getById(sessionId)
        if (existing) await options.metaStorage.update(sessionId, { ...record, recoveryArchived: undefined })
        else await options.metaStorage.create(record)
      }
      await options.recoverSessionList()
      recoveredSessionList = true
    }

    throwIfAborted(options.signal)
    committed = true
    return { importedKeyCount: entriesToImport.length, importedMetaCount, recoveredSessionList }
  } catch (error) {
    const failures: unknown[] = []
    const restore = async (action: () => Promise<unknown>) => {
      try {
        await action()
      } catch (failure) {
        failures.push(failure)
      }
    }
    for (const candidate of [...candidates].reverse()) await restore(() => candidate.rollback())
    if (metadataTouched) {
      await restore(async () => {
        for (const record of await options.metaStorage.getAllIncludingHidden()) {
          await restore(() => options.metaStorage.delete(record.id))
        }
      })
      for (const record of previousMeta) await restore(() => options.metaStorage.create(record))
    }
    for (const { key, previousKey } of changedKeys.reverse()) {
      await restore(async () => {
        if (previousKey) await options.storage.setItemNow(key, await options.storage.getItem(previousKey, null))
        else await options.storage.removeItem(key)
      })
    }
    if (failures.length) {
      rollbackFailed = true
      throw new AggregateError(
        [error, ...failures],
        `Legacy import rollback failed; recovery data retained (${operationId})`
      )
    }
    await cleanup()
    throw error
  } finally {
    if (!rollbackFailed) for (const candidate of candidates) await candidate.dispose()
    if (committed) await cleanup()
  }
}
