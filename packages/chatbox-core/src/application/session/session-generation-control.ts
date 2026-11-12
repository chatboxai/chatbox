import type { SessionKnownMessageMetadata } from '../../ports/session-row-relations'
import type { ThreadRow } from '../../session/session-tree/types'

/** Runtime identities are intersected with durable row state at one revision. */
export function deriveSessionGenerationControl(thread: ThreadRow, runtimeRows: readonly SessionKnownMessageMetadata[]) {
  if (!thread.summary || !thread.control) throw new Error('Session control projection is unavailable')
  const cancellableMessageIds = runtimeRows
    .filter((row) => row.status === 'generating' && row.facts.role === 'assistant')
    .map((row) => row.messageId)
  return {
    generatingReplyCount: cancellableMessageIds.length,
    anyReplyGenerating:
      thread.control.generatingAssistantCount > 0 ||
      thread.summary.generatingMessageCount > 0 ||
      cancellableMessageIds.length > 0,
    awaitingPauseDecision: thread.summary.pausedMessageCount > 0,
    cancellableMessageIds,
  }
}
