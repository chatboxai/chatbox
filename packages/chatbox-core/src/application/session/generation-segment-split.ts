import type { Message, Session } from '../../types'
import type { SessionService } from './SessionService'
import { snapshotStreamingMessage } from './streaming-message-snapshot'
import type { StreamingWriteCoordinator } from './streaming-write-coordinator'

export interface GenerationSegmentSplit {
  prefix: Message
  continuation: Message
  afterMessageId: string
}

/** True means BOTH messages are durable, even if metadata projection rejected. */
export type GenerationSegmentSplitWriter = (
  sessionId: string,
  split: GenerationSegmentSplit,
  signal: AbortSignal
) => Promise<boolean>

type Container = { messages: Message[]; replace(messages: Message[]): Session }

/** Only clone the affected root/thread/fork list; all other paths remain intact. */
function containing(session: Session, messageId: string): Container | undefined {
  if (session.messages.some((message) => message.id === messageId)) {
    return { messages: session.messages, replace: (messages) => ({ ...session, messages }) }
  }
  for (const thread of session.threads ?? []) {
    if (thread.messages.some((message) => message.id === messageId)) {
      return {
        messages: thread.messages,
        replace: (messages) => ({
          ...session,
          threads: session.threads?.map((item) => (item === thread ? { ...item, messages } : item)),
        }),
      }
    }
  }
  for (const [pivot, fork] of Object.entries(session.messageForksHash ?? {})) {
    for (const branch of fork.lists) {
      if (branch.messages.some((message) => message.id === messageId)) {
        return {
          messages: branch.messages,
          replace: (messages) => ({
            ...session,
            messageForksHash: {
              ...session.messageForksHash,
              [pivot]: { ...fork, lists: fork.lists.map((item) => (item === branch ? { ...item, messages } : item)) },
            },
          }),
        }
      }
    }
  }
  return undefined
}

function splitIsCommitted(session: Session, split: GenerationSegmentSplit): boolean {
  const container = containing(session, split.prefix.id)
  const prefix = container?.messages.find((message) => message.id === split.prefix.id)
  const continuation = container?.messages.find((message) => message.id === split.continuation.id)
  return Boolean(
    prefix &&
      !prefix.generating &&
      prefix.finishReason === split.prefix.finishReason &&
      continuation &&
      JSON.stringify(prefix.contentParts) === JSON.stringify(split.prefix.contentParts) &&
      JSON.stringify(continuation.contentParts) === JSON.stringify(split.continuation.contentParts)
  )
}

/** One pure update is the transaction payload. No intermediate empty tail exists. */
export function applyGenerationSegmentSplit(session: Session, split: GenerationSegmentSplit): Session {
  const { prefix, continuation, afterMessageId } = split
  if (
    prefix.id === continuation.id ||
    prefix.role !== 'assistant' ||
    continuation.role !== 'assistant' ||
    prefix.generating !== false ||
    continuation.generating !== true
  ) {
    throw new Error('Invalid generation segment split')
  }
  if (splitIsCommitted(session, split)) return session
  if (containing(session, continuation.id)) throw new Error('Generation continuation id already exists')
  const container = containing(session, prefix.id)
  const targetIndex = container?.messages.findIndex((message) => message.id === prefix.id) ?? -1
  if (!container || targetIndex < 0) throw new Error('Generation split target no longer exists')
  // Stop may have won while this update was queued behind another session write.
  if (!container.messages[targetIndex].generating) return session
  const anchorIndex = container.messages.findIndex((message) => message.id === afterMessageId)
  if (anchorIndex < targetIndex) throw new Error('Generation split anchor is outside the target path')

  let insertIndex = anchorIndex + 1
  while (container.messages[insertIndex]?.isSummary) insertIndex += 1
  const messages = container.messages.map((message, index) => (index === targetIndex ? prefix : message))
  messages.splice(insertIndex, 0, continuation)
  return container.replace(messages)
}

function splitSnapshot(message: Message): Message {
  return {
    ...snapshotStreamingMessage(message),
    // Neither half can reuse token/word counts from the unsplit assistant.
    tokenCount: undefined,
    tokenCountMap: undefined,
    tokenCountApproximate: undefined,
    wordCount: undefined,
  }
}

/**
 * Shared Desktop / RN writer. Terminal serialization first drains/coalesces old
 * checkpoints; then SessionService commits both halves in ONE coordinated write.
 * onFullSessionPersisted is the authority for partial metadata-write failures.
 */
export function createGenerationSegmentSplitWriter(options: {
  sessions: Pick<SessionService, 'updateSessionWithMessages'>
  streamingWrites: Pick<StreamingWriteCoordinator, 'persistTerminal'>
}): GenerationSegmentSplitWriter {
  return async (sessionId, input, signal) => {
    if (signal.aborted) return false
    const split: GenerationSegmentSplit = {
      prefix: splitSnapshot(input.prefix),
      continuation: splitSnapshot(input.continuation),
      afterMessageId: input.afterMessageId,
    }
    let committed = false
    const observeCommit = (session: Session) => {
      committed = splitIsCommitted(session, split)
    }
    try {
      await options.streamingWrites.persistTerminal(`${sessionId}\u0000${split.prefix.id}`, async () => {
        const session = await options.sessions.updateSessionWithMessages(
          sessionId,
          (current) => {
            if (!current) throw new Error(`Session ${sessionId} no longer exists`)
            if (signal.aborted) return current
            return applyGenerationSegmentSplit(current, split)
          },
          {
            preserveCachedGeneratingMessages: true,
            onFullSessionPersisted: observeCommit,
          }
        )
        observeCommit(session)
      })
    } catch (error) {
      // The SessionService already projects/schedules metadata repair. Treat a
      // confirmed full commit as committed; retrying the split would duplicate
      // history, while failing to adopt would leave the new message unowned.
      if (!committed) throw error
    }
    return committed
  }
}
