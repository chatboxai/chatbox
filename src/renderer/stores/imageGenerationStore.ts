import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { createStore, useStore } from 'zustand'
import { getImageGenerationQueries } from './imageGenerationActions'

interface ImageGenerationUIState {
  currentGeneratingId: string | null
  currentRecordId: string | null
  initialized: boolean
}

interface ImageGenerationUIActions {
  setCurrentGeneratingId: (id: string | null) => void
  setCurrentRecordId: (id: string | null) => void
  setInitialized: (initialized: boolean) => void
}

export const imageGenerationStore = createStore<ImageGenerationUIState & ImageGenerationUIActions>((set) => ({
  currentGeneratingId: null,
  currentRecordId: null,
  initialized: false,

  setCurrentGeneratingId: (id) => set({ currentGeneratingId: id }),
  setCurrentRecordId: (id) => set({ currentRecordId: id }),
  setInitialized: (initialized) => set({ initialized }),
}))

export const IMAGE_GEN_QUERY_KEY = 'image-generation'
export const IMAGE_GEN_LIST_QUERY_KEY = 'image-generation-list'

export function useImageGenerationHistory(pageSize = 20) {
  return useInfiniteQuery(getImageGenerationQueries().historyOptions(pageSize))
}

export function useImageGenerationRecord(id: string | null) {
  return useQuery(getImageGenerationQueries().recordOptions(id))
}

export function useImageGenerationRecords(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => getImageGenerationQueries().recordOptions(id)),
    combine: (results) => results.map((result) => result.data ?? null),
  })
}

export async function deleteRecord(id: string): Promise<void> {
  const { getImageGenerationService } = await import('./imageGenerationActions')
  await getImageGenerationService().deleteRecord(id)
}

export function useCurrentGeneratingId() {
  return useStore(imageGenerationStore, (s) => s.currentGeneratingId)
}

export function useCurrentRecordId() {
  return useStore(imageGenerationStore, (s) => s.currentRecordId)
}
