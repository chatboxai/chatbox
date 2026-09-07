import type { PersistStorage, StorageValue } from 'zustand/middleware'

const getBrowserStorage = (): Storage | undefined => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    // ignore access errors
  }
  return undefined
}

export const safeStorage: PersistStorage<unknown> = {
  getItem: <T>(name: string) => {
    const storage = getBrowserStorage()
    if (!storage) {
      return null
    }
    try {
      const value = storage.getItem(name)
      if (!value) {
        return null
      }
      return JSON.parse(value) as StorageValue<T>
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    const storage = getBrowserStorage()
    if (!storage) {
      return
    }
    try {
      storage.setItem(name, JSON.stringify(value))
    } catch {
      // ignore persistence errors so callers don't fail
    }
  },
  removeItem: (name) => {
    const storage = getBrowserStorage()
    if (!storage) {
      return
    }
    try {
      storage.removeItem(name)
    } catch {
      // ignore persistence errors so callers don't fail
    }
  },
}

export function getSafeStorage<T>(): PersistStorage<T> {
  return safeStorage as PersistStorage<T>
}
