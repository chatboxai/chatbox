import type { CompactionPoint, Message } from '../types'
import { orderSteeredMessagesForModel } from '../utils/message'
import { injectAttachments } from './attachments'
import { findLatestApplicableCompactionPoint } from './compaction-points'
import { isContextEligibleMessage } from './message-eligibility'
import { projectContextMessagesForModel } from './model-projection'
import type { ContextBuilderOptions, ContextSelectionOptions } from './types'

export { injectAttachments } from './attachments'

/**
 * Build context for AI from messages.
 * Pure function - does not mutate inputs, no side effects.
 */
export async function buildContext(messages: Message[], options: ContextBuilderOptions): Promise<Message[]> {
  const { attachmentResolver, modelSupportToolUseForFile = false, sandboxMode = false, workspacePath } = options
  // Each message receives its own attachments before a summary handoff merges into the user turn after it.
  const selection = await injectAttachments(selectContextMessages(messages, options), attachmentResolver, {
    modelSupportToolUseForFile,
    sandboxMode,
    workspacePath,
  })
  return projectContextMessagesForModel(selection, { language: options.language })
}

/**
 * The message-selection half of context building: causal ordering, eligibility,
 * compaction-point slicing, error filtering, and the message-count limit —
 * everything that decides WHICH messages are in context, with their content
 * untouched. Exposed so token estimation and compaction planning work on
 * exactly the selection the send path will use; the wording the model-facing
 * projection adds is available from `getContextProjectionText`. Returns the
 * original message references.
 */
export type ContextSelectionEntry = Pick<
  Message,
  'id' | 'role' | 'generating' | 'isForkMarker' | 'isSummary' | 'steered' | 'finishReason' | 'error' | 'errorCode'
>

export function selectContextMessages(messages: Message[], options: ContextSelectionOptions = {}): Message[] {
  return selectContextEntries(messages, options)
}

/** Selection works on row facts; message bodies are hydrated only for the selected identities. */
export function selectContextEntries<T extends ContextSelectionEntry>(
  messages: T[],
  options: ContextSelectionOptions = {}
): T[] {
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

function applyCompaction<T extends ContextSelectionEntry>(
  messages: T[],
  compactionPoints: CompactionPoint[] | undefined
): T[] {
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

  let contextMessages: T[] = [summaryMessage, ...messagesAfterBoundary]

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
function applyMessageLimit<T extends ContextSelectionEntry>(messages: T[], maxCount: number): T[] {
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
