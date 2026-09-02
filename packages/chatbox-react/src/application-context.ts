import type { QueryClient } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import type { ReactQueryHostLifecycle } from './query/host-lifecycle'
import type { AuthInfoStore, LastUsedModelStore, SettingsStore } from './stores'

export interface ChatboxReactApplication {
  authInfoStore?: AuthInfoStore
  lastUsedModelStore?: LastUsedModelStore
  queryClient: QueryClient
  queryLifecycle?: ReactQueryHostLifecycle
  settingsStore?: SettingsStore
}

export const ChatboxApplicationContext = createContext<ChatboxReactApplication | null>(null)

export function useChatboxApplication(): ChatboxReactApplication {
  const application = useContext(ChatboxApplicationContext)
  if (!application) {
    throw new Error('useChatboxApplication must be used inside ChatboxProvider')
  }
  return application
}
