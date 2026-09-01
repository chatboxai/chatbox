import type { Settings } from '@shared/types'
import { cleanSettingsForBackup } from '@shared/utils/backup'

export function settingsPayloadForBackup(
  settings: Settings,
  includeSettings: boolean,
  includeCredentials: boolean
): Record<string, unknown> {
  if (!includeSettings && !includeCredentials) return {}
  return cleanSettingsForBackup(settings, includeCredentials)
}
