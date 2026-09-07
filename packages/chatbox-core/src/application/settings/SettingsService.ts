import {
  createDefaultSettings,
  decodePersistedSettings,
  encodePersistedSettings,
  mergeSettingsWithDefaults,
  migrateSettings,
  SETTINGS_PERSIST_VERSION,
  type Settings,
  type SettingsHostDefaults,
  SettingsSchema,
} from '../../domain/settings'
import type { LoggerPort, SettingsRepositoryPort, SettingsStoragePort, SettingsUpdate } from '../../ports'
import { createMemoryStateToken } from '../../types/agent-persona'

export type SettingsListener = (settings: Settings, previousSettings: Settings) => void

export interface SettingsServiceOptions extends Omit<SettingsHostDefaults, 'isDesktopLike'> {
  /**
   * Hosts that are assembled through an ESM dependency graph may need to defer
   * platform access until hydration. A resolver keeps construction free of
   * platform initialization order while preserving the simple boolean option
   * for React Native and tests.
   */
  isDesktopLike: boolean | (() => boolean)
  initialSettings?: Settings
  logger?: LoggerPort
}

function describeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const cause = 'cause' in error ? error.cause : undefined
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(cause === undefined ? {} : { cause: describeError(cause) }),
  }
}

/**
 * Owns global settings hydration, migrations, validation and persistence.
 *
 * React/Zustand bindings subscribe to this service; they are projections, not a
 * second persistence source.
 */
export class SettingsService implements SettingsRepositoryPort {
  private snapshot: Settings
  private readonly listeners = new Set<SettingsListener>()
  private hydrationPromise: Promise<Settings> | null = null
  private persistenceQueue: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(
    private readonly storage: SettingsStoragePort,
    private readonly options: SettingsServiceOptions
  ) {
    this.snapshot = options.initialSettings ?? createDefaultSettings()
  }

  hydrate(): Promise<Settings> {
    this.assertActive()
    if (!this.hydrationPromise) {
      this.hydrationPromise = this.hydrateOnce()
    }
    return this.hydrationPromise
  }

  getSettings(): Settings {
    return this.snapshot
  }

  updateSettings(update: SettingsUpdate): void {
    this.assertActive()
    const result = typeof update === 'function' ? update(this.snapshot) : update
    const parsed = SettingsSchema.parse({
      ...this.snapshot,
      ...result,
    })
    const nextRecord: Record<string, unknown> = {
      ...(this.snapshot as unknown as Record<string, unknown>),
    }
    const currentRecord = this.snapshot as unknown as Record<string, unknown>
    const resultRecord = result as unknown as Record<string, unknown>
    const parsedRecord = parsed as unknown as Record<string, unknown>
    for (const key of Object.keys(resultRecord)) {
      if (!Object.is(resultRecord[key], currentRecord[key])) {
        nextRecord[key] = parsedRecord[key]
      }
    }
    if ((this.snapshot.memoryEnabled !== false) !== (parsed.memoryEnabled !== false)) {
      nextRecord.memoryStateToken = createMemoryStateToken()
    }
    const next = nextRecord as unknown as Settings
    this.publish(next)
    this.enqueuePersistence(next)
  }

  subscribe(listener: SettingsListener): () => void {
    this.assertActive()
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async flushPersistence(): Promise<void> {
    await this.persistenceQueue
  }

  async clearPersistedSettings(): Promise<void> {
    this.assertActive()
    await this.persistenceQueue
    await this.storage.remove()
  }

  dispose(): void {
    this.listeners.clear()
    this.disposed = true
  }

  private async hydrateOnce(): Promise<Settings> {
    const persisted = decodePersistedSettings(await this.storage.read())
    if (!persisted) return this.snapshot

    const next =
      persisted.version === SETTINGS_PERSIST_VERSION
        ? mergeSettingsWithDefaults(persisted.settings)
        : migrateSettings(persisted.settings, persisted.version, {
            isDesktopLike:
              typeof this.options.isDesktopLike === 'function'
                ? this.options.isDesktopLike()
                : this.options.isDesktopLike,
          })

    this.publish(next)
    return this.snapshot
  }

  private publish(next: Settings): void {
    const previous = this.snapshot
    this.snapshot = next
    for (const listener of this.listeners) {
      listener(next, previous)
    }
  }

  private enqueuePersistence(settings: Settings): void {
    const value = encodePersistedSettings(settings)
    const write = this.persistenceQueue.catch(() => undefined).then(() => this.storage.write(value))
    this.persistenceQueue = write
    void write.catch((error) =>
      this.log('error', 'Failed to persist settings', {
        error: describeError(error),
      })
    )
  }

  private async log(level: 'error', message: string, context: Record<string, unknown>): Promise<void> {
    if (!this.options.logger) return
    try {
      await this.options.logger.log(level, message, context)
    } catch {
      // Logging must never replace the original persistence failure.
    }
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('SettingsService has been disposed')
    }
  }
}
