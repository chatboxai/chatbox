import { atomWithStorage, createJSONStorage } from 'jotai/utils'

const browserStorage = createJSONStorage<string | null>()
const currentSessionStorage = {
  ...browserStorage,
  setItem: (key: string, value: string | null) => {
    try {
      return browserStorage.setItem(key, value)
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error
      console.warn('Could not persist the current session: browser storage quota exceeded')
    }
  },
}

export const currentSessionIdAtom = atomWithStorage<string | null>(
  '_currentSessionIdCachedAtom',
  null,
  currentSessionStorage
)
