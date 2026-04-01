import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import storage from '@/storage'

export function useBlob(storageKey: string | undefined) {
  return useQuery({
    queryKey: ['blob', storageKey],
    queryFn: () => {
      if (!storageKey) return null
      return storage.getBlob(storageKey).catch(() => null)
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
        queryFn: () => storage.getBlob(key).catch(() => null),
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: 60 * 1000,
      }),
    [queryClient]
  )
}
