// Task sessions are not available in the open-source edition
import { createStore, useStore } from 'zustand'

export const taskSessionStore = createStore(() => ({
  currentTaskId: null as string | null,
  initialized: false,
  setCurrentTaskId: (_id: string | null) => {},
  setInitialized: (_initialized: boolean) => {},
}))

export function useTaskSessionStore<T>(selector: (state: ReturnType<typeof taskSessionStore.getState>) => T): T {
  return useStore(taskSessionStore, selector)
}

export async function getTaskSession(_id: string) {
  return null
}
