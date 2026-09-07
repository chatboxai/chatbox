import type { Settings } from '../types'

export type SettingsUpdate = Partial<Settings> | ((current: Settings) => Partial<Settings> | Settings)

export interface SettingsRepositoryPort {
  hydrate(): Promise<Settings>
  getSettings(): Settings
  updateSettings(update: SettingsUpdate): void
  subscribe(listener: (settings: Settings, previousSettings: Settings) => void): () => void
}
