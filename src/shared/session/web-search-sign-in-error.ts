import type { Message } from '../types'

const CHATBOX_SEARCH_LICENSE_REQUIRED = 20024

export function messageHasChatboxSearchSignInError(message: Message | undefined): boolean {
  return (message?.contentParts ?? []).some((part) => {
    if (part.type !== 'tool-call' || part.toolName !== 'web_search' || part.state !== 'error') return false
    const result = part.result as { errorCode?: unknown } | undefined
    return result?.errorCode === CHATBOX_SEARCH_LICENSE_REQUIRED
  })
}

export function latestConversationMessageHasChatboxSearchSignInError(messages: Message[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'system' || message.isForkMarker || message.isSummary) continue
    return messageHasChatboxSearchSignInError(message)
  }
  return false
}
