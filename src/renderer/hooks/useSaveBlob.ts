import { useMutation, useQueryClient } from '@tanstack/react-query'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'

export function useSaveBlob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      await currentBlobStorage.set(key, value)
      return key
    },
    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey: ['blob', key] })
      queryClient.setQueryData(['blob', key], value)
    },
  })
}
