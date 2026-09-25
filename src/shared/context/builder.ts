import type { CompactionPoint, Message } from '../types'
import { orderSteeredMessagesForModel } from '../utils/message'
import { injectAttachments } from './attachments'
import { findLatestApplicableCompactionPoint } from './compaction-points'
import { isContextEligibleMessage } from './message-eligibility'
import type { ContextBuilderOptions, ContextPreparationOptions, ContextSelectionOptions } from './types'

export { injectAttachments } from './attachments'

/**
 * Build context for AI from messages.
 * Pure function - does not mutate inputs, no side effects.
 */
export async function buildContext(messages: Message[], options: ContextBuilderOptions): Promise<Message[]> {
  const { attachmentResolver, modelSupportToolUseForFile = false, sandboxMode = false } = options
  const contextMessages = prepareContextMessages(messages, options)
  return await injectAttachments(contextMessages, attachmentResolver, modelSupportToolUseForFile, sandboxMode)
}

/** The shared send window, before attachment injection. */
export function prepareContextMessages(messages: Message[], options: ContextPreparationOptions): Message[] {
  return selectContextMessages(messages, options)
}

/**
 * The message-selection half of context building: causal ordering, eligibility,
 * compaction-point slicing, error filtering, and the message-count limit —
 * everything that decides WHICH messages are in context, with their content
 * untouched. Exposed so token estimation can measure exactly the selection
 * the send path will use. Returns the original message references.
 */
export function selectContextMessages(messages: Message[], options: ContextSelectionOptions = {}): Message[] {
  const { compactionPoints, maxContextMessageCount } = options

  // Legacy steering records stored the steered user after the assistant reply
  // it interrupted; restore causal order before compaction and message limits
  // so it is never replayed as an unanswered trailing turn. Current records are
  // already persisted in true causal order and pass through unchanged.
  const completedMessages = orderSteeredMessagesForModel(messages).filter(isContextEligibleMessage)

  if (completedMessages.length === 0) {
    return []
  }

  let contextMessages = applyCompaction(completedMessages, compactionPoints)

  contextMessages = contextMessages.filter((m) => !m.error && !m.errorCode)

  if (maxContextMessageCount !== undefined && maxContextMessageCount < Number.MAX_SAFE_INTEGER) {
    contextMessages = applyMessageLimit(contextMessages, maxContextMessageCount)
  }

  return contextMessages
}

function applyCompaction(messages: Message[], compactionPoints: CompactionPoint[] | undefined): Message[] {
  const latestCompactionPoint = findLatestApplicableCompactionPoint(messages, compactionPoints)

  // A summary may only enter context as the stand-in of an applied compaction
  // point. In fallback paths any summary on the current path is orphaned (its
  // boundary lives on another branch or its point was lost) and would leak a
  // summary of other content alongside the full history.
  if (!latestCompactionPoint) {
    return messages.filter((m) => !m.isSummary)
  }

  const boundaryIndex = messages.findIndex((m) => m.id === latestCompactionPoint.boundaryMessageId)
  const summaryMessage = messages.find((m) => m.id === latestCompactionPoint.summaryMessageId)

  // findLatestApplicableCompactionPoint guarantees both exist in `messages`.
  if (boundaryIndex === -1 || !summaryMessage) {
    return messages.filter((m) => !m.isSummary)
  }

  const messagesAfterBoundary = messages.slice(boundaryIndex + 1).filter((m) => !m.isSummary)

  let contextMessages: Message[] = [summaryMessage, ...messagesAfterBoundary]

  const systemMessage = messages.find((m) => m.role === 'system')
  if (systemMessage && !contextMessages.some((m) => m.id === systemMessage.id)) {
    contextMessages = [systemMessage, ...contextMessages]
  }

  return contextMessages
}

/**
 * Apply message count limit to context messages.
 * The limit applies to history messages only, preserving the last user message (current input).
 * This is achieved by adding 1 to maxCount since the last message is always the current input.
 */
function applyMessageLimit(messages: Message[], maxCount: number): Message[] {
  const head = messages[0]?.role === 'system' ? messages[0] : undefined
  const workingMsgs = head ? messages.slice(1) : messages

  // maxCount limits history, +1 for the current input (last message)
  const effectiveLimit = maxCount + 1

  const overflow = workingMsgs.length - effectiveLimit
  if (overflow <= 0) {
    return head ? [head, ...workingMsgs] : [...workingMsgs]
  }

  // Sticky window: advance the drop boundary in whole chunks instead of
  // sliding one message per turn. A per-turn slide rewrites the start of the
  // request every round, invalidating the provider prompt-cache prefix; a
  // chunked boundary stays fixed (cache hit) until the overflow crosses the
  // next chunk, at the cost of briefly serving up to chunk-1 messages fewer
  // than the configured limit.
  const chunk = Math.max(1, Math.ceil(effectiveLimit / 4))
  const dropCount = Math.ceil(overflow / chunk) * chunk
  const result = workingMsgs.slice(dropCount)

  return head ? [head, ...result] : result
}
