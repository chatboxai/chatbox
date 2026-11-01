import { atomWithStorage } from 'jotai/utils'

// current sessionId
export const currentSessionIdAtom = atomWithStorage<string | null>('_currentSessionIdCachedAtom', null)
