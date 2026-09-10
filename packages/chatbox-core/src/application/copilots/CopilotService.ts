import type { CopilotDetail, ImageSource } from '@shared/types'
import type { KeyValueStoragePort } from '../../ports'

export const MY_COPILOTS_STORAGE_KEY = 'myCopilots'

export interface CopilotSnapshot {
  copilots: readonly CopilotDetail[]
  isLoading: boolean
  error: Error | null
}

export interface CopilotStorageScope {
  /** Refresh the service after an import while retaining the storage lock. */
  reload(): Promise<void>
}

export interface CopilotServiceOptions {
  storage: Pick<KeyValueStoragePort, 'get' | 'set'>
  now?: () => number
}

export function isCopilotDetail(value: unknown): value is CopilotDetail {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.prompt === 'string' &&
    ['picUrl', 'description', 'sourceId'].every((key) => value[key] === undefined || typeof value[key] === 'string') &&
    ['createdAt', 'updatedAt', 'usedCount'].every(
      (key) => value[key] === undefined || (typeof value[key] === 'number' && Number.isFinite(value[key]))
    ) &&
    (value.starred === undefined || typeof value.starred === 'boolean') &&
    (value.avatar === undefined || isImageSource(value.avatar)) &&
    (value.backgroundImage === undefined || isImageSource(value.backgroundImage)) &&
    (value.tags === undefined || (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string'))) &&
    (value.screenshots === undefined || (Array.isArray(value.screenshots) && value.screenshots.every(isImageSource)))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isImageSource(value: unknown): value is ImageSource {
  return (
    isRecord(value) &&
    ((value.type === 'url' && typeof value.url === 'string') ||
      (value.type === 'storage-key' && typeof value.storageKey === 'string'))
  )
}

export function searchCopilots(copilots: readonly CopilotDetail[], search: string): CopilotDetail[] {
  const query = search.trim().toLowerCase()
  return copilots.filter(
    (copilot) =>
      !query ||
      [copilot.name, copilot.prompt, copilot.description ?? ''].some((value) => value.toLowerCase().includes(query))
  )
}

/** Owns the existing myCopilots value and coordinates edits with backup storage access. */
export class CopilotService {
  private snapshot: CopilotSnapshot = { copilots: [], isLoading: true, error: null }
  private records: CopilotDetail[] = []
  private hydrated = false
  private hydrationPromise: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<() => void>()
  private readonly now: () => number

  constructor(private readonly options: CopilotServiceOptions) {
    this.now = options.now ?? Date.now
  }

  getSnapshot = (): CopilotSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hydrate(): Promise<void> {
    if (this.hydrated) return Promise.resolve()
    if (!this.hydrationPromise) {
      const hydration = this.enqueue(() => this.ensureHydrated())
      this.hydrationPromise = hydration
      void hydration
        .finally(() => {
          if (this.hydrationPromise === hydration) this.hydrationPromise = null
        })
        .catch(() => undefined)
    }
    return this.hydrationPromise
  }

  reload(): Promise<void> {
    return this.enqueue(() => this.read())
  }

  upsert(copilot: CopilotDetail): Promise<CopilotDetail> {
    return this.enqueue(async () => {
      await this.ensureHydrated()
      return this.writeCopilot(copilot)
    })
  }

  addFeatured(copilot: CopilotDetail): Promise<CopilotDetail> {
    return this.upsert({
      id: copilot.id,
      name: copilot.name,
      prompt: copilot.prompt,
      avatar: copilot.avatar ?? (copilot.picUrl ? { type: 'url', url: copilot.picUrl } : undefined),
      backgroundImage: copilot.backgroundImage,
      description: copilot.description,
    })
  }

  remove(id: string): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureHydrated()
      await this.persist(this.records.filter((copilot) => copilot.id !== id))
    })
  }

  setStarred(id: string, starred: boolean): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureHydrated()
      const copilot = this.records.find((record) => record.id === id)
      if (!copilot) return
      await this.writeCopilot({ ...copilot, starred })
    })
  }

  async flush(): Promise<void> {
    await this.queue
  }

  withStorageLock<T>(operation: (scope: CopilotStorageScope) => Promise<T>): Promise<T> {
    return this.enqueue(() => operation({ reload: () => this.read() }), false)
  }

  private enqueue<T>(operation: () => Promise<T>, reportError = true): Promise<T> {
    const pending = this.queue
      .catch(() => undefined)
      .then(operation)
      .catch((error: unknown) => {
        if (reportError) this.reportError(error)
        throw error
      })
    this.queue = pending
    // Subscribers receive failures even when a host starts hydration without awaiting it.
    void pending.catch(() => undefined)
    return pending
  }

  private async ensureHydrated(): Promise<void> {
    if (!this.hydrated) await this.read()
  }

  private async read(): Promise<void> {
    this.hydrated = false
    this.publish({ ...this.snapshot, isLoading: true, error: null })
    try {
      const stored = await this.options.storage.get<unknown>(MY_COPILOTS_STORAGE_KEY)
      if (stored !== null && (!Array.isArray(stored) || !stored.every(isCopilotDetail))) {
        throw new Error('Invalid saved Copilots')
      }
      this.records = stored ?? []
      this.hydrated = true
      this.publishRecords()
    } catch (error) {
      this.reportError(error)
      throw error
    }
  }

  private reportError(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    if (this.snapshot.error !== error || this.snapshot.isLoading) {
      this.publish({ ...this.snapshot, isLoading: false, error })
    }
  }

  private async writeCopilot(copilot: CopilotDetail): Promise<CopilotDetail> {
    const name = copilot.name.trim()
    const prompt = copilot.prompt.trim()
    if (!copilot.id || !name || !prompt) throw new Error('Copilot name and prompt are required')
    const previous = this.records.find((record) => record.id === copilot.id)
    const now = this.now()
    const next: CopilotDetail = {
      ...previous,
      ...copilot,
      name,
      prompt,
      ...(copilot.description === undefined ? {} : { description: copilot.description.trim() }),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    const records = previous
      ? this.records.map((record) => (record.id === next.id ? next : record))
      : [next, ...this.records]
    await this.persist(records)
    return next
  }

  private async persist(records: CopilotDetail[]): Promise<void> {
    await this.options.storage.set(MY_COPILOTS_STORAGE_KEY, records)
    this.records = records
    this.publishRecords()
  }

  private publishRecords(): void {
    this.publish({
      copilots: [
        ...this.records.filter((copilot) => copilot.starred),
        ...this.records.filter((copilot) => !copilot.starred),
      ],
      isLoading: false,
      error: null,
    })
  }

  private publish(snapshot: CopilotSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}
