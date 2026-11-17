import type { SessionConversationState, SessionConversationStateRequest } from '../../ports/session-row-repository'
import type { SessionMessageRelationsCursor } from '../../ports/session-row-relations'
import { SessionRowConflictError, type SessionRowStorePort } from '../../ports/session-row-store'
import { contextHeader } from './row-context'

/** Independent queue/admission read: metadata membership and at most three message bodies. */
export async function readRowConversationState(
  rows: SessionRowStorePort,
  request: SessionConversationStateRequest
): Promise<SessionConversationState | null> {
  const commit = await rows.readCommit(request.sessionId)
  if (!commit) return null
  if (request.expectedRevision !== undefined && request.expectedRevision !== commit.revision)
    throw new SessionRowConflictError(request.sessionId, request.expectedRevision, commit.revision)
  const expectedRevision = commit.revision
  const thread = await rows.readThreadState({ sessionId: request.sessionId, expectedRevision })
  if (!thread || thread.status !== 'ready') throw new Error('Conversation thread facts are unavailable')
  const requestedIds = [...new Set(request.messageIds ?? [])]
  if (requestedIds.length > 32) throw new Error('Conversation membership request exceeds 32 messages')
  const membership = requestedIds.length
    ? await rows.readMessageMetadata({ sessionId: request.sessionId, messageIds: requestedIds, expectedRevision })
    : null
  if (membership && membership.status !== 'ready') throw new Error('Conversation membership facts are unavailable')
  const matchedMessageIds =
    membership?.status === 'ready'
      ? membership.rows
          .filter((row) => row.selected && row.threadId === thread.thread.threadId)
          .map((row) => row.messageId)
      : []
  const reverseTail: string[] = []
  let lastAssistantId: string | undefined
  let lastSettledMessageId: string | undefined
  let cursor: SessionMessageRelationsCursor | undefined
  if (thread.thread.activeLeafMessageId)
    do {
      const page = await rows.readMessageRelationsPage({
        sessionId: request.sessionId,
        threadId: thread.thread.threadId,
        selector: { kind: 'ancestors', messageId: thread.thread.activeLeafMessageId },
        limit: 200,
        expectedRevision,
        cursor,
      })
      if (!page || page.status !== 'ready') throw new Error('Conversation tail facts are unavailable')
      for (const row of page.rows) {
        if (reverseTail.length < 2) reverseTail.push(row.messageId)
        if (!lastAssistantId && row.facts.role === 'assistant') lastAssistantId = row.messageId
        if (!lastSettledMessageId && row.status !== 'generating') lastSettledMessageId = row.messageId
        if (reverseTail.length === 2 && lastAssistantId && lastSettledMessageId) break
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor && !(reverseTail.length === 2 && lastAssistantId && lastSettledMessageId))
  const messageIds = [...new Set([...reverseTail, ...(lastAssistantId ? [lastAssistantId] : [])])]
  const read = messageIds.length
    ? await rows.readMessages({ sessionId: request.sessionId, messageIds, expectedRevision })
    : null
  const messages = new Map(read?.messages.map((row) => [row.messageId, row.message]) ?? [])
  if (messages.size !== messageIds.length) throw new Error('Conversation tail messages are unavailable')
  return {
    header: contextHeader(commit.record, thread.thread),
    revision: expectedRevision,
    activeThreadId: thread.thread.threadId,
    matchedMessageIds,
    tailMessages: reverseTail.reverse().map((id) => messages.get(id)!),
    lastAssistantMessage: lastAssistantId ? messages.get(lastAssistantId) : undefined,
    lastSettledMessageId,
  }
}
