import { useQuery } from '@tanstack/react-query'
import { QueryKeys } from '@chatbox/react/query'
import { rendererApplication } from '@/app/renderer-application'
import { getSessionSettings } from '@/stores/session/session-settings'

export function useSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: QueryKeys.ChatSession(sessionId ?? ''),
    queryFn: () => {
      if (!sessionId) return null
      return rendererApplication.sessionQueryBridge.getSession(sessionId)
    },
    enabled: !!sessionId,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSessionSettings(sessionId: string | undefined) {
  return useQuery({
    queryKey: QueryKeys.ChatSessionSettings(sessionId ?? ''),
    queryFn: () => {
      if (!sessionId) return null
      return getSessionSettings(sessionId)
    },
    enabled: !!sessionId,
  })
}
