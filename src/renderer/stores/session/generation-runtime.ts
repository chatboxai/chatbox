import { createStore, useStore } from 'zustand'

type GenerationRuntimeState = {
  generatingCountBySession: Record<string, number>
}

const initialState: GenerationRuntimeState = {
  generatingCountBySession: {},
}

export const generationRuntimeStore = createStore<GenerationRuntimeState>(() => initialState)

export function beginSessionGeneration(sessionId: string): void {
  generationRuntimeStore.setState((state) => ({
    generatingCountBySession: {
      ...state.generatingCountBySession,
      [sessionId]: (state.generatingCountBySession[sessionId] ?? 0) + 1,
    },
  }))
}

export function settleSessionGeneration(sessionId: string): void {
  generationRuntimeStore.setState((state) => {
    const currentCount = state.generatingCountBySession[sessionId] ?? 0
    if (currentCount === 0) return state

    const generatingCountBySession = { ...state.generatingCountBySession }
    if (currentCount === 1) {
      delete generatingCountBySession[sessionId]
    } else {
      generatingCountBySession[sessionId] = currentCount - 1
    }
    return { generatingCountBySession }
  })
}

export function isSessionGenerating(state: GenerationRuntimeState, sessionId: string): boolean {
  return (state.generatingCountBySession[sessionId] ?? 0) > 0
}

export function useSessionGenerating(sessionId: string): boolean {
  return useStore(generationRuntimeStore, (state) => isSessionGenerating(state, sessionId))
}

export function resetSessionGenerationRuntime(): void {
  generationRuntimeStore.setState(initialState, true)
}
