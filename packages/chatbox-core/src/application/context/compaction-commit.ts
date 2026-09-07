import { findMessageSourceThread } from '../../session/message-forks'
import type { CompactionPoint, Message, Session } from '../../types'

/**
 * Insert a completed summary next to its boundary wherever that boundary moved
 * while generation was streaming. Compaction points travel with the owning
 * active conversation or archived thread.
 */
export function buildCompactionCommitPatch(
  session: Session,
  summaryMessage: Message,
  compactionPoint: CompactionPoint
): Session | null {
  const { boundaryMessageId } = compactionPoint
  const owningThreadId = findMessageSourceThread(session, boundaryMessageId)?.id ?? null
  const withPoint = (patch: Partial<Session>): Session => {
    const base = { ...session, ...patch }
    if (!owningThreadId) {
      return { ...base, compactionPoints: [...(session.compactionPoints ?? []), compactionPoint] }
    }
    const threads = (patch.threads ?? session.threads ?? []).map((thread) =>
      thread.id === owningThreadId
        ? { ...thread, compactionPoints: [...(thread.compactionPoints ?? []), compactionPoint] }
        : thread
    )
    return { ...base, threads }
  }

  const rootIndex = session.messages.findIndex((message) => message.id === boundaryMessageId)
  if (rootIndex >= 0) {
    return withPoint({ messages: insertAfter(session.messages, rootIndex, summaryMessage) })
  }

  for (const [pivotId, fork] of Object.entries(session.messageForksHash ?? {})) {
    for (let listIndex = 0; listIndex < fork.lists.length; listIndex += 1) {
      const branchIndex = fork.lists[listIndex].messages.findIndex((message) => message.id === boundaryMessageId)
      if (branchIndex < 0) continue

      const lists = fork.lists.map((list, index) =>
        index === listIndex ? { ...list, messages: insertAfter(list.messages, branchIndex, summaryMessage) } : list
      )
      return withPoint({
        messageForksHash: {
          ...session.messageForksHash,
          [pivotId]: { ...fork, lists },
        },
      })
    }
  }

  const threads = session.threads ?? []
  for (let threadIndex = 0; threadIndex < threads.length; threadIndex += 1) {
    const messageIndex = threads[threadIndex].messages.findIndex((message) => message.id === boundaryMessageId)
    if (messageIndex < 0) continue

    const updatedThreads = threads.map((thread, index) =>
      index === threadIndex
        ? { ...thread, messages: insertAfter(thread.messages, messageIndex, summaryMessage) }
        : thread
    )
    return withPoint({ threads: updatedThreads })
  }

  return null
}

function insertAfter(messages: Message[], index: number, message: Message): Message[] {
  return [...messages.slice(0, index + 1), message, ...messages.slice(index + 1)]
}
