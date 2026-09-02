import { type PersistStorage, persist } from 'zustand/middleware'
import { useStore } from 'zustand/react'
import { createStore } from 'zustand/vanilla'

export const LAST_USED_MODEL_PERSIST_KEY = 'last-used-model'
export const LAST_USED_MODEL_PERSIST_VERSION = 0

export interface LastUsedModel {
  provider: string
  modelId: string
}

export interface LastUsedModelState {
  chat?: LastUsedModel
  picture?: LastUsedModel
  task?: LastUsedModel
}

export interface LastUsedModelActions {
  setChatModel(provider: string, modelId: string): void
  setPictureModel(provider: string, modelId: string): void
  setTaskModel(provider: string, modelId: string): void
}

export type LastUsedModelStoreState = LastUsedModelState & LastUsedModelActions

export interface CreateLastUsedModelStoreOptions {
  storage: PersistStorage<LastUsedModelState>
  skipHydration?: boolean
}

export function createLastUsedModelStore(options: CreateLastUsedModelStoreOptions) {
  return createStore<LastUsedModelStoreState>()(
    persist(
      (set) => ({
        chat: undefined,
        picture: undefined,
        task: undefined,
        setChatModel(provider, modelId) {
          set({ chat: { provider, modelId } })
        },
        setPictureModel(provider, modelId) {
          set({ picture: { provider, modelId } })
        },
        setTaskModel(provider, modelId) {
          set({ task: { provider, modelId } })
        },
      }),
      {
        name: LAST_USED_MODEL_PERSIST_KEY,
        version: LAST_USED_MODEL_PERSIST_VERSION,
        storage: options.storage,
        skipHydration: options.skipHydration,
        partialize: ({ chat, picture, task }) => ({ chat, picture, task }),
      }
    )
  )
}

export type LastUsedModelStore = ReturnType<typeof createLastUsedModelStore>

export function useLastUsedModelStore<T>(
  store: LastUsedModelStore,
  selector: (state: LastUsedModelStoreState) => T
): T {
  return useStore(store, selector)
}
