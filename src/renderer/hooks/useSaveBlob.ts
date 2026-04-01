import { useMutation, useQueryClient } from '@tanstack/react-query'
import storage from '@/storage'

export function useSaveBlob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      await storage.setBlob(key, value)
      return key
    },
    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey: ['blob', key] })
      queryClient.setQueryData(['blob', key], value)
    },
  })
}
