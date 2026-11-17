import { useQuery } from '@tanstack/react-query'
import { QueryKeys } from '@chatbox/react/query'
import { rendererApplication } from '@/app/renderer-application'
import { getSessionSettings } from '@/stores/session/session-settings'

export function useSessionHeader(sessionId: string | undefined) {
  const query = rendererApplication.sessionHooks.useSessionHeader(sessionId ?? null)
  return { ...query, data: query.session }
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
