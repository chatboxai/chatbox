import { atom, getDefaultStore } from 'jotai'

export type CompactionStatus = 'idle' | 'running' | 'completed' | 'failed'

export interface CompactionUIState {
  status: CompactionStatus
  error: string | null
  streamingText: string
  summaryMessageId: string | null
}

const defaultCompactionUIState: CompactionUIState = {
  status: 'idle',
  error: null,
  streamingText: '',
  summaryMessageId: null,
}

export const compactionUIStateMapAtom = atom<Record<string, CompactionUIState>>({})

export function getCompactionUIState(sessionId: string): CompactionUIState {
  const store = getDefaultStore()
  const stateMap = store.get(compactionUIStateMapAtom)
  return stateMap[sessionId] ?? defaultCompactionUIState
}

export function setCompactionUIState(sessionId: string, state: Partial<CompactionUIState>): void {
  const store = getDefaultStore()
  const currentMap = store.get(compactionUIStateMapAtom)
  const currentState = currentMap[sessionId] ?? defaultCompactionUIState
  store.set(compactionUIStateMapAtom, {
    ...currentMap,
    [sessionId]: {
      ...currentState,
      ...state,
    },
  })
}
