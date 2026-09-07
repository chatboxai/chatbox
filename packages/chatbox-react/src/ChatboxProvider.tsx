import { QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { ChatboxApplicationContext, type ChatboxReactApplication } from './application-context'
import { bindReactQueryHostLifecycle } from './query/host-lifecycle'

export interface ChatboxProviderProps {
  application: ChatboxReactApplication
  children: ReactNode
}

/** Provides one host-owned application instance to a React tree. */
export function ChatboxProvider({ application, children }: ChatboxProviderProps) {
  useEffect(() => {
    if (!application.queryLifecycle) return
    return bindReactQueryHostLifecycle(application.queryLifecycle)
  }, [application.queryLifecycle])

  return (
    <ChatboxApplicationContext.Provider value={application}>
      <QueryClientProvider client={application.queryClient}>{children}</QueryClientProvider>
    </ChatboxApplicationContext.Provider>
  )
}
