import { findLatestApplicableCompactionPoint, selectContextMessages } from '@shared/context'
import type { CompactionPoint, Message, Session, SessionSettings, SessionThread, Settings } from '@shared/types'

export interface BuildContextOptions {
  messages: Message[]
  compactionPoints?: CompactionPoint[]
  sessionSettings?: SessionSettings
  settings?: Partial<Settings>
}

/**
 * Builds the context selection for estimation/UI/compaction purposes by
 * delegating to the shared send-path selection (`selectContextMessages`):
 * causal ordering of legacy steered records, eligibility, latest applicable
 * compaction point, error filtering. Sharing the selection matters for
 * compaction in particular — the boundary is chosen over this list, and a
 * list ordered differently from what is actually sent could place the
 * boundary so that the same reply lands in both the summary and the raw tail.
 *
 * Content is returned at full fidelity — tool calls and results intact. Any
 * send-path cleanup (pressure-driven result stubbing) happens in the shared
 * buildContext() at request time; estimation must measure the un-relieved
 * context so pressure decisions are driven by real size.
 *
 * Note: Messages with `generating: true` are excluded from context as they are incomplete.
 */
export function buildContextForAI(options: BuildContextOptions): Message[] {
  const { messages, compactionPoints } = options

  return selectContextMessages(messages, { compactionPoints })
}

export function computeContextAfterCompaction(messages: Message[], compactionPoints?: CompactionPoint[]): Message[] {
  const latestCompactionPoint = findLatestApplicableCompactionPoint(messages, compactionPoints)

  // A summary may only enter context as the stand-in of an applied compaction
  // point; orphaned summaries (boundary on another branch, point lost) must
  // not leak into the full-history fallback.
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

export function buildContextForSession(
  session: Session,
  options?: {
    threadId?: string
    settings?: Partial<Settings>
  }
): Message[] {
  const { threadId, settings } = options ?? {}

  if (threadId && session.threads) {
    const thread = session.threads.find((t) => t.id === threadId)
    if (thread) {
      return buildContextForThread(thread, { sessionSettings: session.settings, settings })
    }
  }

  return buildContextForAI({
    messages: session.messages,
    compactionPoints: session.compactionPoints,
    sessionSettings: session.settings,
    settings,
  })
}

export function buildContextForThread(
  thread: SessionThread,
  options?: {
    sessionSettings?: SessionSettings
    settings?: Partial<Settings>
  }
): Message[] {
  const { sessionSettings, settings } = options ?? {}

  return buildContextForAI({
    messages: thread.messages,
    compactionPoints: thread.compactionPoints,
    sessionSettings,
    settings,
  })
}

export function getContextMessageIds(session: Session, maxCount?: number): string[] {
  const contextMessages = buildContextForSession(session)
  const ids = contextMessages.map((m) => m.id)

  if (maxCount !== undefined) {
    if (maxCount <= 0) {
      return []
    }
    return ids.slice(-maxCount)
  }

  return ids
}
