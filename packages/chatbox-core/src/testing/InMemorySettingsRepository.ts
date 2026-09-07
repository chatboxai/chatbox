import type { SettingsRepositoryPort, SettingsUpdate } from '../ports'
import type { Settings } from '../types'

export class InMemorySettingsRepository implements SettingsRepositoryPort {
  private readonly listeners = new Set<(settings: Settings, previousSettings: Settings) => void>()

  constructor(private settings: Settings) {}

  hydrate(): Promise<Settings> {
    return Promise.resolve(this.settings)
  }

  getSettings(): Settings {
    return this.settings
  }

  updateSettings(update: SettingsUpdate): void {
    const previousSettings = this.settings
    const patch = typeof update === 'function' ? update(previousSettings) : update
    this.settings = { ...previousSettings, ...patch }
    for (const listener of this.listeners) listener(this.settings, previousSettings)
  }

  subscribe(listener: (settings: Settings, previousSettings: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
