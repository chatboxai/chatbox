import {
  createLastUsedModelStore,
  type LastUsedModelState,
  type LastUsedModelStoreState,
  useLastUsedModelStore as useSharedLastUsedModelStore,
} from '@chatbox/react/stores'
import { getSafeStorage } from './safeStorage'

export const lastUsedModelStore = createLastUsedModelStore({
  storage: getSafeStorage(),
  skipHydration: true,
})

let initLastUsedModelStorePromise: Promise<LastUsedModelState> | undefined
export function initLastUsedModelStore(): Promise<LastUsedModelState> {
  if (!initLastUsedModelStorePromise) {
    initLastUsedModelStorePromise = new Promise<LastUsedModelState>((resolve) => {
      const unsubscribe = lastUsedModelStore.persist.onFinishHydration((state) => {
        unsubscribe()
        resolve(state)
      })
      void lastUsedModelStore.persist.rehydrate()
    })
  }
  return initLastUsedModelStorePromise
}

export function useLastUsedModelStore<T>(selector: (state: LastUsedModelStoreState) => T): T {
  return useSharedLastUsedModelStore(lastUsedModelStore, selector)
}
