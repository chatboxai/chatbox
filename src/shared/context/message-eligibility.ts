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
