import type { SessionHeaderRead } from '@chatbox/core/ports'
import { QueryKeys } from '@chatbox/react/query'
import { rendererApplication } from '@/app/renderer-application'
import { trackJkViewEvent } from './jk'
import { JK_EVENTS } from './jk-events'

async function getPageSessionName(sessionId: string): Promise<string | undefined> {
  const read = rendererApplication.queryClient.getQueryData<SessionHeaderRead | null>(
    QueryKeys.ChatSessionHeader(sessionId)
  )
  if (read !== undefined) return read?.header.name
  return (await rendererApplication.sessions.getSessionHeader(sessionId).catch(() => null))?.header.name
}

export async function trackPageView(pageName: string, sessionId?: string): Promise<void> {
  const content = sessionId !== undefined ? await getPageSessionName(sessionId) : undefined
  trackJkViewEvent(JK_EVENTS.PAGE_VIEW, { pageName, content })
}
