import platform from '@/platform'
import { JK_PAGE_NAMES } from './jk-events'

export type ChatTrackingMode = 'chat_mode' | 'work_mode'

export type ChatTrackingContext = {
  sessionId: string
  mode: ChatTrackingMode
  provider?: string
  model?: string
}

export function buildChatJkTrackingOptions(context: ChatTrackingContext) {
  return {
    pageName: JK_PAGE_NAMES.CHAT_PAGE,
    platform: platform.type === 'web' ? ('web' as const) : ('app' as const),
    props: {
      agent_info: {
        mode: context.mode,
        session_id: context.sessionId,
      },
    },
  }
}
