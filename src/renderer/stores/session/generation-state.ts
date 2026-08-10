import type { Message, Session } from '@shared/types'

type GenerationStateMessage = Pick<Message, 'role' | 'generating' | 'cancel'>

export function isCancellableGeneratingAssistantMessage(message: GenerationStateMessage): boolean {
  return message.role === 'assistant' && message.generating === true && typeof message.cancel === 'function'
}

export function countCancellableGeneratingAssistantMessages(messages: GenerationStateMessage[]): number {
  return messages.reduce((count, message) => count + Number(isCancellableGeneratingAssistantMessage(message)), 0)
}

function collectReachableMessages(session: Session, initialLists: Message[][]): Message[] {
  const messages: Message[] = []
  const seenMessageIds = new Set<string>()
  const visitedForkIds = new Set<string>()
  const pendingLists = [...initialLists]

  while (pendingLists.length > 0) {
    const list = pendingLists.shift()
    if (!list) {
      continue
    }

    for (const message of list) {
      if (!seenMessageIds.has(message.id)) {
        seenMessageIds.add(message.id)
        messages.push(message)
      }

      const fork = session.messageForksHash?.[message.id]
      if (!fork || visitedForkIds.has(message.id)) {
        continue
      }
      visitedForkIds.add(message.id)
      for (const branch of fork.lists) {
        pendingLists.push(branch.messages)
      }
    }
  }

  return messages
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
 * Current conversation messages are always included. Historical threads and
 * their forks are included only while they have a runtime cancel callback, so
 * stale persisted `generating: true` flags cannot lock the session.
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
