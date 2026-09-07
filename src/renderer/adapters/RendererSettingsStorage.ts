import type { SettingsStoragePort } from '@chatbox/core/ports'
import storage from '@/storage'

export const SETTINGS_STORAGE_KEY = 'settings'

/**
 * Renderer adapter for the historical global settings value.
 *
 * It deliberately stores the raw envelope unchanged; SettingsService owns
 * validation, migrations and versioning.
 */
export class RendererSettingsStorage implements SettingsStoragePort {
  read(): Promise<unknown> {
    return storage.getItem(SETTINGS_STORAGE_KEY, null)
  }

  write(value: unknown): Promise<void> {
    return storage.setItem(SETTINGS_STORAGE_KEY, value)
  }

  remove(): Promise<void> {
    return storage.removeItem(SETTINGS_STORAGE_KEY)
  }
}
