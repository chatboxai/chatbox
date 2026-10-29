import { createStore, useStore } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import storage from '@/storage'

const ONBOARDING_STORAGE_KEY = 'onboarding'

export interface OnboardingState {
  /** Whether the user has completed the onboarding guide */
  completed: boolean
}

interface OnboardingActions {
  /** Mark onboarding as completed */
  markCompleted: () => void
  /** Reset onboarding state (for testing/debugging) */
  reset: () => void
}

export const onboardingStore = createStore<OnboardingState & OnboardingActions>()(
  persist(
    (set) => ({
      completed: false,

      markCompleted: () => set({ completed: true }),

      reset: () => set({ completed: false }),
    }),
    {
      name: ONBOARDING_STORAGE_KEY,
      storage: createJSONStorage(() => ({
        getItem: async (key) => {
          const res = await storage.getItem<OnboardingState | null>(key, null)
          if (res) {
            return JSON.stringify({ state: res })
          }
          return null
        },
        setItem: async (_name, value) => {
          const { state } = JSON.parse(value) as { state: OnboardingState }
          await storage.setItem(ONBOARDING_STORAGE_KEY, state)
        },
        removeItem: async () => await storage.removeItem(ONBOARDING_STORAGE_KEY),
      })),
      skipHydration: true,
    }
  )
)

// React hooks for accessing the store
export const useOnboardingStore = <T>(selector: (state: OnboardingState & OnboardingActions) => T): T =>
  useStore(onboardingStore, selector)

export const useOnboardingCompleted = () => useOnboardingStore((s) => s.completed)

// Initialize onboarding store and wait for hydration to complete
let _initOnboardingStorePromise: Promise<OnboardingState> | undefined
export const initOnboardingStore = async () => {
  if (!_initOnboardingStorePromise) {
    _initOnboardingStorePromise = new Promise<OnboardingState>((resolve) => {
      const unsub = onboardingStore.persist.onFinishHydration((val) => {
        unsub()
        resolve(val)
      })
      onboardingStore.persist.rehydrate()
    })
  }
  return await _initOnboardingStorePromise
}
