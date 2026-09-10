import type { SessionMetaRecord } from '@shared/types'
import { SessionMetaRecordSchema } from '@shared/types'
import { BackupStorageKey } from './storage-keys'
import type { BackupMetaStorage, BackupStorage } from './types'

export interface LegacyBackupDataStore {
  getData<T>(key: string, defaultValue: T): Promise<T>
  setData<T>(key: string, value: T): Promise<void>
  setAll(data: Record<string, unknown>): Promise<void>
}

export interface LegacyBackupImportOptions {
  storage: BackupStorage
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
  file: File,
  options: LegacyBackupImportOptions
): Promise<LegacyBackupImportResult> {
  const parsed: unknown = JSON.parse(await file.text())
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Unsupported legacy backup data format')
  }
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
  })

  const entriesToImport = Object.entries(importData).filter(
    ([key]) =>
      key !== BackupStorageKey.ChatSessionsList && key !== BackupStorageKey.ConfigVersion && !key.startsWith('__')
  )
  for (const [key, value] of entriesToImport) await options.storage.setItemNow(key, value)

  const rawMetaValue = importData[BackupStorageKey.ChatSessionsList]
  const rawMeta: unknown[] | undefined = Array.isArray(rawMetaValue) ? rawMetaValue : undefined
  let importedMetaCount = 0
  let recoveredSessionList = false
  if (rawMeta) {
    for (const item of rawMeta) {
      const record = normalizeMeta(item)
      if (!record) continue
      const existing = await options.metaStorage.getById(record.id)
      if (existing)
        await options.metaStorage.update(record.id, { ...record, recoveryArchived: record.recoveryArchived })
      else await options.metaStorage.create(record)
      importedMetaCount++
    }
  } else if (entriesToImport.some(([key]) => key.startsWith('session:'))) {
    for (const [key] of entriesToImport) {
      if (!key.startsWith('session:')) continue
      const sessionId = key.slice('session:'.length)
      if (!sessionId) continue
      const existing = await options.metaStorage.getById(sessionId)
      if (existing) await options.metaStorage.update(sessionId, { recoveryArchived: undefined })
    }
    await options.recoverSessionList()
    recoveredSessionList = true
  }

  return { importedKeyCount: entriesToImport.length, importedMetaCount, recoveredSessionList }
}
