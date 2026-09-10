import type { KeyValueStoragePort } from '../../ports'

export const COPILOT_PREFERENCES_STORAGE_KEY = 'copilots.showInNewSession'

export interface CopilotPreferencesSnapshot {
  showCopilots: boolean
  isLoading: boolean
  error: Error | null
}

export class CopilotPreferences {
  private snapshot: CopilotPreferencesSnapshot = { showCopilots: false, isLoading: true, error: null }
  private hydrated = false
  private queue: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly options: { storage: Pick<KeyValueStoragePort, 'get' | 'set'> }) {}

  getSnapshot = (): CopilotPreferencesSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hydrate(): Promise<void> {
    return this.enqueue(() => this.readOnce())
  }

  reload(): Promise<void> {
    return this.enqueue(() => this.readOnce(true))
  }

  setShowCopilots(showCopilots: boolean): Promise<void> {
    return this.enqueue(async () => {
      await this.readOnce()
      await this.options.storage.set(COPILOT_PREFERENCES_STORAGE_KEY, showCopilots)
      this.publish({ showCopilots, isLoading: false, error: null })
    })
  }

  private async readOnce(force = false): Promise<void> {
    if (this.hydrated && !force) return
    this.hydrated = false
    this.publish({ ...this.snapshot, isLoading: true, error: null })
    const stored = await this.options.storage.get<unknown>(COPILOT_PREFERENCES_STORAGE_KEY)
    this.hydrated = true
    this.publish({ showCopilots: stored === true, isLoading: false, error: null })
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const pending = this.queue
      .catch(() => undefined)
      .then(operation)
      .catch((error: unknown) => {
        this.publish({
          ...this.snapshot,
          isLoading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        })
        throw error
      })
    this.queue = pending
    void pending.catch(() => undefined)
    return pending
  }

  private publish(snapshot: CopilotPreferencesSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}
