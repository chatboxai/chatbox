import type { Message } from '@shared/types'

type MessageLayout = 'left' | 'bubble' | undefined

export function shouldRightAlignMessage(messageLayout: MessageLayout, role: Message['role']): boolean {
  return messageLayout === 'bubble' && role === 'user'
}

export function isErrorOnlyMessage(message: Message): boolean {
  return Boolean(
    message.role === 'assistant' &&
      message.error &&
      !message.reasoningContent?.trim() &&
      !message.status?.some((status) => status.type === 'preparing_tool_call') &&
      !message.contentParts?.some((part) => {
        if (part.type === 'reasoning') return !part.protocolOnly && part.text.trim().length > 0
        if (part.type === 'text' || part.type === 'info') return part.text.trim().length > 0
        return true
      })
  )
}
