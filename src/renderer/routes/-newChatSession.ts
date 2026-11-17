import type { CopilotDetail, SessionHeader } from '@shared/types'

type AssistantIdentity = Pick<SessionHeader, 'assistantAvatarKey' | 'assistantName' | 'picUrl' | 'backgroundImage'>
type NewSessionCopilot = Pick<CopilotDetail, 'id' | 'avatar' | 'picUrl' | 'backgroundImage'>

/** Assistant look chosen while the chat was still new, carried into the session that gets created. */
export function getNewChatAssistantFields(session: AssistantIdentity): AssistantIdentity {
  return {
    assistantAvatarKey: session.assistantAvatarKey,
    assistantName: session.assistantName?.trim() || undefined,
    picUrl: session.picUrl,
    backgroundImage: session.backgroundImage,
  }
}

/** Copilot identity for a new chat. Conversation title stays on `session.name`. */
export function applyCopilotToNewSession(session: SessionHeader, copilot: NewSessionCopilot): SessionHeader {
  return {
    ...session,
    copilotId: copilot.id,
    assistantAvatarKey: copilot.avatar?.type === 'storage-key' ? copilot.avatar.storageKey : undefined,
    picUrl: copilot.avatar?.type === 'url' ? copilot.avatar.url : copilot.picUrl,
    backgroundImage: copilot.backgroundImage,
    threadName: session.threadName ?? '',
  }
}

export function clearCopilotFromNewSession(session: SessionHeader): SessionHeader {
  return {
    ...session,
    copilotId: undefined,
    assistantAvatarKey: undefined,
    picUrl: undefined,
    backgroundImage: undefined,
  }
}
