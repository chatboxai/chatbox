import type { SettingsStoragePort } from '@chatbox/core/ports'
import platform from '@/platform'
import storage from '@/storage'

export const SETTINGS_STORAGE_KEY = 'settings'

/**
 * Renderer adapter for the historical global settings value.
 *
 * Electron host reads share the main-process recovery policy. Valid envelopes remain
 * unchanged; SettingsService owns validation, migrations and versioning.
 */
export class RendererSettingsStorage implements SettingsStoragePort {
  read(): Promise<unknown> {
    return platform.isDesktopLike ? platform.getSettings() : storage.getItem(SETTINGS_STORAGE_KEY, null)
  }

  write(value: unknown): Promise<void> {
    return storage.setItem(SETTINGS_STORAGE_KEY, value)
  }

  remove(): Promise<void> {
    return storage.removeItem(SETTINGS_STORAGE_KEY)
  }
}
