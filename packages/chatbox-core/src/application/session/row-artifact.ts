import { throwIfAborted } from '../../backup/abort'
import type { SessionArtifactRequest } from '../../ports/session-artifact-source'
import type { SessionMessageRelationsCursor } from '../../ports/session-row-relations'
import type { SessionRowStorePort } from '../../ports/session-row-store'
import { getMessageText } from '../../utils/message'

/** Holds causal identities and one payload at a time while the consumer reduces code blocks. */
export async function* iterateRowArtifactMarkdown(
  rows: SessionRowStorePort,
  request: SessionArtifactRequest
): AsyncIterable<string> {
  const { sessionId, messageId, signal } = request
  throwIfAborted(signal)
  const commit = await rows.readCommit(sessionId)
  if (!commit) throw new Error('Artifact session is missing')
  const expectedRevision = commit.revision
  const selected = await rows.readMessageMetadata({ sessionId, messageIds: [messageId], expectedRevision })
  if (!selected || selected.status !== 'ready' || selected.rows.length !== 1)
    throw new Error('Artifact target is missing')
  const target = selected.rows[0]
  const thread = await rows.readThread({ sessionId, threadId: target.threadId, expectedRevision })
  if (!thread) throw new Error('Artifact thread is missing')
  const reverseIds: string[] = []
  const seen = new Set<string>()
  let expectedId: string | null = messageId
  let cursor: SessionMessageRelationsCursor | undefined
  do {
    throwIfAborted(signal)
    const page = await rows.readMessageRelationsPage({
      sessionId,
      threadId: target.threadId,
      selector: { kind: 'ancestors', messageId },
      expectedRevision,
      limit: 200,
      cursor,
    })
    if (!page || page.status !== 'ready') throw new Error('Artifact path is unavailable')
    for (const row of page.rows) {
      if (row.messageId !== expectedId || seen.has(row.messageId)) throw new Error('Artifact path is inconsistent')
      seen.add(row.messageId)
      if (row.messageId !== messageId) reverseIds.push(row.messageId)
      expectedId = row.parentMessageId
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  if (expectedId !== null || (reverseIds.at(-1) ?? messageId) !== thread.thread.rootMessageId)
    throw new Error('Artifact path does not reach its thread root')
  for (let index = reverseIds.length - 1; index >= 0; index--) {
    throwIfAborted(signal)
    const id = reverseIds[index]
    const page = await rows.readMessages({ sessionId, messageIds: [id], expectedRevision })
    throwIfAborted(signal)
    const row = page?.messages[0]
    if (!row || page.messages.length !== 1 || row.messageId !== id || row.threadId !== target.threadId)
      throw new Error('Artifact payload is missing')
    yield getMessageText(row.message)
  }
}
