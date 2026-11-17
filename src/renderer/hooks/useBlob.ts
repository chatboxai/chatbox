import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'

export function useBlob(storageKey: string | undefined) {
  return useQuery({
    queryKey: ['blob', storageKey],
    queryFn: () => {
      if (!storageKey) return null
      return currentBlobStorage.get(storageKey).catch(() => null)
    },
    enabled: !!storageKey,
    staleTime: Number.POSITIVE_INFINITY,
    // Blobs (base64/data URLs) can be large; GC quickly once unmounted.
    gcTime: 60 * 1000,
  })
}

export function useFetchBlob() {
  const queryClient = useQueryClient()
  return useCallback(
    (key: string) =>
      queryClient.fetchQuery({
        queryKey: ['blob', key],
        queryFn: () => currentBlobStorage.get(key).catch(() => null),
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: 60 * 1000,
      }),
    [queryClient]
  )
}
