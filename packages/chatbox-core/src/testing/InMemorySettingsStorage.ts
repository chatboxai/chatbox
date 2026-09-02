import type { SettingsStoragePort } from '../ports'

export class InMemorySettingsStorage implements SettingsStoragePort {
  constructor(private value: unknown = null) {}

  async read(): Promise<unknown> {
    await Promise.resolve()
    return this.value
  }

  async write(value: unknown): Promise<void> {
    await Promise.resolve()
    this.value = value
  }

  async remove(): Promise<void> {
    await Promise.resolve()
    this.value = null
  }

  snapshot(): unknown {
    return this.value
  }
}
