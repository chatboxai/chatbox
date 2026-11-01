import { isContextEligibleMessage } from '@shared/context/message-eligibility'
import type { Message } from '../../types'

/**
 * Find the last non-summary message that survives context eligibility filters.
 * Keep this predicate aligned with shared context building. System messages are
 * never boundaries: they are re-prepended to context after compaction, so a
 * summary "covering" only a system prompt would add noise without removing
 * anything.
 */
export function findLastCompactionBoundaryMessage(messages: Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (isContextEligibleMessage(message) && !message.isSummary && message.role !== 'system') {
      return message
    }
  }
  return undefined
}
