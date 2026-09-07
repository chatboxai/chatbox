import { isContextEligibleMessage } from '@shared/context/message-eligibility'
import { findRecentRoundsStartIndex } from '@shared/context/rounds'
import type { Message } from '../../types'

/** How many recent conversation rounds stay raw (uncompacted) after a compaction. */
export const KEEP_RAW_TAIL_ROUNDS = 2

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

export interface CompactionBoundaryOptions {
  keepRawTailRounds?: number
  /**
   * Largest raw tail (in estimated tokens) allowed to survive a compaction.
   * A rounds-only tail can itself exceed the model window (huge attachments or
   * tool payloads in the last rounds), leaving the post-compaction context
   * still overflowing — and the submit path compacts only once per turn.
   * Requires `estimateMessagesTokens`; without both, tails are rounds-only.
   */
  maxTailTokens?: number
  estimateMessagesTokens?: (messages: Message[]) => number
}

/**
 * Choose the compaction boundary over the current context messages, keeping the
 * last `keepRawTailRounds` conversation rounds raw: the summary then stands in
 * for everything up to the boundary while the freshest exchanges survive
 * verbatim, so "as I just said" references keep working right after a
 * compaction.
 *
 * Falls back gradually — fewer tail rounds, then the pre-tail behavior of
 * compacting through the last message — when the conversation is too short to
 * afford a tail, or when the candidate tail exceeds the token budget.
 * Operating on the already-selected context list guarantees the boundary
 * always advances past any previously applied compaction point.
 */
export function findCompactionBoundaryMessage(
  contextMessages: Message[],
  options: CompactionBoundaryOptions = {}
): Message | undefined {
  const { keepRawTailRounds = KEEP_RAW_TAIL_ROUNDS, maxTailTokens, estimateMessagesTokens } = options

  for (let rounds = Math.max(0, keepRawTailRounds); rounds > 0; rounds -= 1) {
    const tailStartIndex = findRecentRoundsStartIndex(contextMessages, rounds)
    const boundary = findLastCompactionBoundaryMessage(contextMessages.slice(0, tailStartIndex))
    if (!boundary) {
      continue
    }
    if (maxTailTokens !== undefined && estimateMessagesTokens) {
      // Estimation failures degrade to rounds-only tails — the budget is an
      // optimization and must never make compaction itself fail.
      let tailTokens = 0
      try {
        tailTokens = estimateMessagesTokens(contextMessages.slice(tailStartIndex))
      } catch {
        tailTokens = 0
      }
      if (tailTokens > maxTailTokens) {
        continue
      }
    }
    return boundary
  }

  return findLastCompactionBoundaryMessage(contextMessages)
}
