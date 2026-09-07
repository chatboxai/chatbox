import { type SessionReadModel, sessionReadModelHeader } from '@chatbox/core/ports'
import { QueryKeys } from '@chatbox/react/query'
import { rendererApplication } from '@/app/renderer-application'
import { trackJkViewEvent } from './jk'
import { JK_EVENTS } from './jk-events'

async function getPageSessionName(sessionId: string): Promise<string | undefined> {
  const model = rendererApplication.queryClient.getQueryData<SessionReadModel | null>(
    QueryKeys.ChatSessionReadModel(sessionId)
  )
  if (model !== undefined) return model ? sessionReadModelHeader(model).name : undefined

  const session = rendererApplication.sessionQueryBridge.getCachedSession(sessionId)
  if (session !== undefined) return session?.name

  const source = await rendererApplication.sessions.readSessionMessages({ sessionId, messageIds: [] }).catch(() => null)
  return source?.header.name
}

export async function trackPageView(pageName: string, sessionId?: string): Promise<void> {
  const content = sessionId !== undefined ? await getPageSessionName(sessionId) : undefined
  trackJkViewEvent(JK_EVENTS.PAGE_VIEW, { pageName, content })
}
