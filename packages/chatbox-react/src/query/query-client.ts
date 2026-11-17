import { QueryClient } from '@tanstack/react-query'

/**
 * Creates a host-owned QueryClient.
 *
 * Shared bindings deliberately expose a factory rather than a singleton so
 * Electron, Web, Capacitor, and React Native can each provide their own cache.
 */
export function createChatQueryClient(): QueryClient {
  const queryClient = new QueryClient()
  queryClient.setQueryDefaults(['chat-session-message'], { structuralSharing: false, gcTime: 0 })
  return queryClient
}
