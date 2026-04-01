import { createStore } from 'zustand/vanilla'
import platform from '@/platform'

interface OnboardingState {
  completed: boolean
  setCompleted: (completed: boolean) => void
}

const STORAGE_KEY = 'onboarding-completed'

export const onboardingStore = createStore<OnboardingState>((set) => ({
  completed: false,
  setCompleted: (completed: boolean) => {
    set({ completed })
    platform.setStoreValue(STORAGE_KEY, JSON.stringify(completed))
  },
}))

export async function initOnboardingStore() {
  try {
    const value = await platform.getStoreValue(STORAGE_KEY)
    if (value) {
      onboardingStore.setState({ completed: JSON.parse(value) })
    }
  } catch {
    // ignore
  }
}
