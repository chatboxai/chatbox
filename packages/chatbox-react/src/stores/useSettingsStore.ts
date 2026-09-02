import { useStore } from 'zustand/react'
import type { SettingsStore, SettingsStoreState } from './createSettingsStore'

export function useSettingsStore<T>(store: SettingsStore, selector: (state: SettingsStoreState) => T): T {
  return useStore(store, selector)
}
