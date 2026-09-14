import { v4 as uuid } from 'uuid'
import type { CopilotDetail, Session, Settings } from '@shared/types'
import { resolveImportedMemoryState, translateImportedSessionMemoryState } from './import-backup'
import { restoreCopilotResourceKeys, restoreSettingsResourceKeys } from './resources'
import { AGENT_PERSONA_BACKUP_KEYS, BackupStorageKey, COPILOT_BACKUP_KEYS } from './storage-keys'
import { throwIfAborted } from './abort'
import type { BackupManifest, BackupStorage } from './types'
import type { BackupManifestV3 } from './sharded-format'

export async function prepareGlobalRestore(
  manifest: BackupManifestV3,
  values: Map<string, unknown>,
  storage: BackupStorage,
  resourceKeys: ReadonlyMap<string, string>,
  signal?: AbortSignal
) {
  const staged = new Map(
    Object.values(manifest.data).map((entry) => [entry.path, { ...entry, value: values.get(entry.path) }])
  )
  const memory = await resolveImportedMemoryState({ ...manifest, formatVersion: 2 }, staged, storage)
  const importedValue = (path: string) => staged.get(path)?.value
  const changes = new Map<string, unknown>()
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid global backup data')
    return value as Record<string, unknown>
  }
  if (manifest.data.settings)
    changes.set(
      BackupStorageKey.Settings,
      restoreSettingsResourceKeys(object(importedValue(manifest.data.settings.path)) as Partial<Settings>, resourceKeys)
    )
  if (manifest.data.copilots) {
    const value = importedValue(manifest.data.copilots.path)
    if (!Array.isArray(value)) throw new Error('Invalid backup copilots')
    changes.set(BackupStorageKey.MyCopilots, restoreCopilotResourceKeys(value as CopilotDetail[], resourceKeys))
  }
  if (manifest.data.sessionSettings) {
    const value = object(importedValue(manifest.data.sessionSettings.path))
    for (const key of [
      BackupStorageKey.ChatSessionSettings,
      BackupStorageKey.PictureSessionSettings,
      ...AGENT_PERSONA_BACKUP_KEYS,
      ...COPILOT_BACKUP_KEYS,
    ])
      if (Object.hasOwn(value, key)) changes.set(key, value[key])
  }
  const existing = new Set(await storage.getAllKeys())
  const previous = new Map<string, string | null>()
  const prefix = `__chatbox_backup_import:globals:${uuid()}`
  const written: string[] = []
  const dispose = async () => {
    const failures: unknown[] = []
    for (const key of previous.values())
      if (key)
        try {
          await storage.removeItem(key)
        } catch (error) {
          failures.push(error)
        }
    if (failures.length)
      throw new AggregateError(failures, `Backup global cleanup failed; recovery data retained (${prefix})`)
  }
  try {
    for (const key of changes.keys()) {
      throwIfAborted(signal)
      if (!existing.has(key)) {
        previous.set(key, null)
        continue
      }
      const rollbackKey = `${prefix}:${previous.size}`
      previous.set(key, rollbackKey)
      await storage.setItemNow(rollbackKey, await storage.getItem<unknown>(key, null))
    }
  } catch (error) {
    try {
      await dispose()
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Backup global preparation cleanup failed')
    }
    throw error
  }
  return {
    translate: (session: Session) => translateImportedSessionMemoryState(session, memory),
    async publish() {
      for (const [key, value] of changes) {
        throwIfAborted(signal)
        written.push(key)
        await storage.setItemNow(key, value)
      }
      throwIfAborted(signal)
    },
    async rollback() {
      const failures: unknown[] = []
      for (const key of written.toReversed())
        try {
          const previousKey = previous.get(key)
          if (previousKey) {
            const sentinel = {}
            const value = await storage.getItem<unknown>(previousKey, sentinel)
            if (value === sentinel) throw new Error('Backup global rollback value is missing')
            await storage.setItemNow(key, value)
          } else await storage.removeItem(key)
        } catch (error) {
          failures.push(error)
        }
      if (failures.length)
        throw new AggregateError(failures, `Backup global rollback failed; recovery data retained (${prefix})`)
    },
    dispose,
  }
}
