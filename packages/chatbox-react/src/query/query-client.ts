import { QueryClient } from '@tanstack/react-query'

/**
 * Creates a host-owned QueryClient.
 *
 * Shared bindings deliberately expose a factory rather than a singleton so
 * Electron, Web, Capacitor, and React Native can each provide their own cache.
 */
export function createChatQueryClient(): QueryClient {
  const queryClient = new QueryClient()
  // Session updates are immutable and already preserve unchanged branches.
  // Re-running replaceEqualDeep over a large message tree on every stream
  // chunk duplicates that work on the renderer main thread.
  queryClient.setQueryDefaults(['chat-session'], { structuralSharing: false })
  return queryClient
}
