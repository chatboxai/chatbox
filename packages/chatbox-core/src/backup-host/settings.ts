import type { SettingsService } from '../application/settings/SettingsService'
import {
  decodePersistedSettings,
  encodePersistedSettings,
  mergeSettingsWithDefaults,
  migrateSettings,
  SETTINGS_PERSIST_VERSION,
  type SettingsHostDefaults,
} from '../domain/settings'

interface BackupSettingsHost extends SettingsHostDefaults {
  settings: Pick<SettingsService, 'replaceSettings'>
  write(value: unknown): Promise<void>
}

/** Commit imported settings durably, then update the active service before processing more records. */
export async function commitBackupSettings(value: unknown, host: BackupSettingsHost): Promise<void> {
  const persisted = decodePersistedSettings(value)
  if (!persisted) throw new Error('Invalid backup settings')
  const settings =
    persisted.version === SETTINGS_PERSIST_VERSION
      ? mergeSettingsWithDefaults(persisted.settings)
      : migrateSettings(persisted.settings, persisted.version, host)
  await host.write(encodePersistedSettings(settings))
  host.settings.replaceSettings(settings)
}
