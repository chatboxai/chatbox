import type { Message } from '../types'
import { getMessageText, isEmptyMessage } from '../utils/message'

const UNSUCCESSFUL_FINISH_REASONS = new Set([
  'agent-mode-suggested',
  'canceled',
  'cancelled',
  'content-filter',
  'error',
  'tool-call-paused',
])

function hasMeaningfulAssistantOutput(message: Message): boolean {
  const text = getMessageText(message, true, true).trim()
  if (text.length > 0) return true

  return message.contentParts.some((part) => {
    if (part.type === 'image') return true
    if (part.type !== 'tool-call') return false
    return part.state === 'result' && part.result !== undefined
  })
}

function isFailedOrNonReplyAssistant(message: Message): boolean {
  if (message.role !== 'assistant') return true
  if (message.error || message.errorCode) return true
  // finishReason only describes a settled turn. Resuming a paused tool call flips
  // generating back to true without clearing the stale 'tool-call-paused' reason.
  if (!message.generating && message.finishReason && UNSUCCESSFUL_FINISH_REASONS.has(message.finishReason)) return true
  if (message.contentParts.some((part) => part.type === 'agent-mode-suggestion')) return true
  if (message.contentParts.some((part) => part.type === 'tool-call' && part.state === 'paused')) return true
  return false
}

export function isSuccessfulAssistantReply(message: Message): boolean {
  if (message.role !== 'assistant') return false
  if (message.generating) return false
  if (isFailedOrNonReplyAssistant(message)) return false
  return hasMeaningfulAssistantOutput(message)
}

/** Whether the Session has enough content to auto-generate a title. */
export function hasContentForAutoTitle(messages: Message[]): boolean {
  let hasPreviousUserMessage = false

  for (const message of messages) {
    if (message.role === 'user' && !isEmptyMessage(message)) {
      hasPreviousUserMessage = true
      continue
    }
    if (!hasPreviousUserMessage || message.role !== 'assistant' || isFailedOrNonReplyAssistant(message)) {
      continue
    }
    if (message.generating || hasMeaningfulAssistantOutput(message)) {
      return true
    }
  }

  return false
}

export function hasSuccessfulUserAssistantTurn(messages: Message[]): boolean {
  let hasPreviousUserMessage = false

  for (const message of messages) {
    if (message.role === 'user' && !isEmptyMessage(message)) {
      hasPreviousUserMessage = true
      continue
    }
    if (hasPreviousUserMessage && isSuccessfulAssistantReply(message)) {
      return true
    }
  }

  return false
}
