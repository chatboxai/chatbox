import type { Message } from '../types'

/**
 * A message is eligible for AI context when it is complete (not generating)
 * and is not a UI-only fork marker.
 *
 * Compaction boundary selection must only pick messages that survive this
 * filter — otherwise context building cannot find the boundary and falls
 * back to full history. Keep every new exclusion here so both stay in sync.
 */
export function isContextEligibleMessage(message: Pick<Message, 'generating' | 'isForkMarker'>): boolean {
  return !message.generating && !message.isForkMarker
}

/**
 * The messages before a generation target, for context building. A resumed
 * continuation includes its own target, which stays flagged `generating` for
 * the UI; its tool calls and results are exactly the context the follow-up
 * request continues from, so that message is passed on as complete.
 */
export function selectMessagesBeforeTarget(
  messages: Message[],
  targetIndex: number,
  resumesLastMessage: boolean
): Message[] {
  const selected = messages.slice(0, targetIndex)
  const resumed = selected.at(-1)
  if (!resumesLastMessage || !resumed?.generating) return selected
  return [...selected.slice(0, -1), { ...resumed, generating: false }]
}
