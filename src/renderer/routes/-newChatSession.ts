import type { SessionHeader } from '@shared/types'

type AssistantIdentity = Pick<SessionHeader, 'assistantAvatarKey' | 'assistantName' | 'picUrl' | 'backgroundImage'>

/** Assistant look chosen while the chat was still new, carried into the session that gets created. */
export function getNewChatAssistantFields(session: AssistantIdentity): AssistantIdentity {
  return {
    assistantAvatarKey: session.assistantAvatarKey,
    assistantName: session.assistantName?.trim() || undefined,
    picUrl: session.picUrl,
    backgroundImage: session.backgroundImage,
  }
}
