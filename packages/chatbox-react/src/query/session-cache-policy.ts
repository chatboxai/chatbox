import type { Message, Session } from '@chatbox/core'

export function mergeCachedGeneratingMessages(updated: Session, cached: Session | null | undefined): Session {
  if (!cached) return updated

  const cachedGeneratingMessageById = new Map<string, Message>()
  const collectGeneratingMessages = (messages: Message[]) => {
    for (const message of messages) {
      if (message.generating) {
        cachedGeneratingMessageById.set(message.id, message)
      }
    }
  }

  collectGeneratingMessages(cached.messages)
  for (const thread of cached.threads ?? []) {
    collectGeneratingMessages(thread.messages)
  }
  for (const fork of Object.values(cached.messageForksHash ?? {})) {
    for (const list of fork.lists) {
      collectGeneratingMessages(list.messages)
    }
  }

  const mergeMessages = (updatedMessages: Message[]) => {
    return updatedMessages.map((message) => {
      const cachedMessage = cachedGeneratingMessageById.get(message.id)
      return cachedMessage && message.generating ? cachedMessage : message
    })
  }

  return {
    ...updated,
    messages: mergeMessages(updated.messages),
    threads: updated.threads?.map((thread) => {
      return {
        ...thread,
        messages: mergeMessages(thread.messages),
      }
    }),
    messageForksHash: updated.messageForksHash
      ? Object.fromEntries(
          Object.entries(updated.messageForksHash).map(([forkMessageId, fork]) => [
            forkMessageId,
            {
              ...fork,
              lists: fork.lists.map((list) => ({
                ...list,
                messages: mergeMessages(list.messages),
              })),
            },
          ])
        )
      : undefined,
  }
}
