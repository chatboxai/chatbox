import { collectReachableMessages } from '@shared/session/message-forks'
import type { Message, Session } from '@shared/types'

type GenerationStateMessage = Pick<Message, 'role' | 'generating' | 'cancel'>

export function isCancellableGeneratingAssistantMessage(message: GenerationStateMessage): boolean {
  return message.role === 'assistant' && message.generating === true && typeof message.cancel === 'function'
}

export function countCancellableGeneratingAssistantMessages(messages: GenerationStateMessage[]): number {
  return messages.reduce((count, message) => count + Number(isCancellableGeneratingAssistantMessage(message)), 0)
}

/**
 * Return messages reachable from the current conversation, including saved
 * fork branches but excluding historical threads.
 */
export function getCurrentConversationMessages(session: Session): Message[] {
  return collectReachableMessages(session, [session.messages])
}

/**
 * Return messages that should control the session-level generating UI.
 *
 * Current conversation messages keep their existing behavior, including the
 * short placeholder window before an AbortController is registered. Historical
 * threads and their forks are included only while they have a runtime cancel
 * callback, so stale persisted `generating: true` flags cannot lock the session.
 */
export function getGenerationControlMessages(session: Session): Message[] {
  const currentMessages = getCurrentConversationMessages(session)
  const currentMessageIds = new Set(currentMessages.map((message) => message.id))
  const visibleMessages = collectReachableMessages(session, [
    session.messages,
    ...(session.threads ?? []).map((thread) => thread.messages),
  ])

  return visibleMessages.filter(
    (message) => currentMessageIds.has(message.id) || isCancellableGeneratingAssistantMessage(message)
  )
}
