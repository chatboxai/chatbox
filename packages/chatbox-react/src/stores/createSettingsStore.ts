import { type Settings, SettingsSchema, type SettingsService } from '@chatbox/core'
import { produce, type WritableDraft } from 'immer'
import { createStore, type StoreApi } from 'zustand/vanilla'

export type SettingsHydrationStatus = 'idle' | 'hydrating' | 'hydrated' | 'error'

export type SettingsActionUpdate = Partial<Settings> | ((settings: WritableDraft<Settings>) => void)

export interface SettingsStoreActions {
  setSettings(update: SettingsActionUpdate): void
  getSettings(): Settings
  hydrate(): Promise<Settings>
  destroy(): void
}

export interface SettingsStoreMetadata {
  hydrationStatus: SettingsHydrationStatus
  hydrationError: string | null
}

export type SettingsStoreState = Settings & SettingsStoreActions & SettingsStoreMetadata

type CompatibleStateUpdater =
  | ((state: WritableDraft<SettingsStoreState>) => void)
  | ((state: WritableDraft<SettingsStoreState>) => SettingsStoreState | Partial<SettingsStoreState>)

export type SettingsStoreSetStateUpdate = SettingsStoreState | Partial<SettingsStoreState> | CompatibleStateUpdater

export type SettingsStore = Omit<StoreApi<SettingsStoreState>, 'setState'> & {
  setState(update: SettingsStoreSetStateUpdate, replace?: boolean): void
}

function createSettingsUpdate(current: Settings, candidate: unknown): Partial<Settings> {
  const parsed = SettingsSchema.parse(candidate)
  const currentRecord = current as unknown as Record<string, unknown>
  const candidateRecord = candidate as Record<string, unknown>
  const parsedRecord = parsed as unknown as Record<string, unknown>
  const updateRecord: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(currentRecord), ...Object.keys(parsedRecord)])) {
    if (!Object.is(candidateRecord[key], currentRecord[key])) {
      updateRecord[key] = parsedRecord[key]
    }
  }
  return updateRecord as Partial<Settings>
}

function applySettingsAction(current: Settings, update: SettingsActionUpdate): Partial<Settings> {
  if (typeof update !== 'function') {
    return update
  }
  return createSettingsUpdate(current, produce(current, update))
}

/**
 * Creates a host-owned vanilla store backed by one SettingsService.
 *
 * The returned StoreApi keeps a compatibility `setState()` implementation so
 * existing Renderer callers are persisted through SettingsService instead of
 * mutating an independent Zustand source of truth.
 */
export function createSettingsStore(service: SettingsService): SettingsStore {
  let unsubscribeService: () => void = () => undefined
  let hydrationPromise: Promise<Settings> | null = null

  const store = createStore<SettingsStoreState>()((set) => ({
    ...service.getSettings(),
    hydrationStatus: 'idle',
    hydrationError: null,
    setSettings(update) {
      service.updateSettings(applySettingsAction(service.getSettings(), update))
    },
    getSettings() {
      return service.getSettings()
    },
    hydrate() {
      if (!hydrationPromise) {
        set({ hydrationStatus: 'hydrating', hydrationError: null })
        hydrationPromise = service
          .hydrate()
          .then((settings) => {
            set({ ...settings, hydrationStatus: 'hydrated', hydrationError: null })
            return settings
          })
          .catch((error: unknown) => {
            set({
              hydrationStatus: 'error',
              hydrationError: error instanceof Error ? error.message : String(error),
            })
            hydrationPromise = null
            throw error
          })
      }
      return hydrationPromise
    },
    destroy() {
      unsubscribeService()
      unsubscribeService = () => undefined
    },
  }))

  const internalSetState = store.setState
  unsubscribeService = service.subscribe((settings) => {
    internalSetState(settings)
  })

  store.setState = ((update, replace) => {
    const current = store.getState()
    let candidate: SettingsStoreState | Partial<SettingsStoreState>

    if (typeof update === 'function') {
      candidate = produce(current, (draft) => {
        const result = (update as CompatibleStateUpdater)(draft)
        if (result === undefined) return
        return (replace ? result : { ...current, ...result }) as SettingsStoreState
      })
    } else {
      candidate = replace ? update : { ...current, ...update }
    }

    service.updateSettings(createSettingsUpdate(service.getSettings(), candidate))
  }) as StoreApi<SettingsStoreState>['setState']

  return store as SettingsStore
}
