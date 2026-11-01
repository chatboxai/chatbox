import type { SessionAttachmentFacts, SessionAttachmentFactsRequest } from '../../ports/session-attachment-source'
import type { SessionMessageRelationsCursor } from '../../ports/session-row-relations'
import {
  SessionRowConflictError,
  type SessionRowStorePort,
  type SessionThreadPageCursor,
} from '../../ports/session-row-store'

/** Workspace checks and ownership maintenance consume stored references, never message payloads. */
export async function* iterateRowAttachmentFacts(
  rows: SessionRowStorePort,
  request: SessionAttachmentFactsRequest
): AsyncGenerator<SessionAttachmentFacts> {
  const { sessionId, signal, scope } = request
  signal?.throwIfAborted()
  const commit = await rows.readCommit(sessionId)
  if (!commit) throw new Error('Attachment source session is unavailable')
  const { revision } = commit
  let threadCursor: SessionThreadPageCursor | undefined
  do {
    signal?.throwIfAborted()
    const threads =
      scope === 'active-path'
        ? { ...commit, threads: [{ threadId: commit.record.activeThreadId }], nextCursor: null }
        : await rows.readThreadSummariesPage({ sessionId, limit: 200, cursor: threadCursor })
    if (!threads) throw new Error('Attachment thread identities are unavailable')
    if (threads.revision !== revision) throw new SessionRowConflictError(sessionId, revision, threads.revision)
    for (const { threadId } of threads.threads) {
      signal?.throwIfAborted()
      const state = await rows.readThreadState({ sessionId, threadId, expectedRevision: revision })
      if (!state || state.status !== 'ready') throw new Error('Attachment thread metadata is unavailable')
      const root = state.thread.rootMessageId
      if (!root) continue
      let cursor: SessionMessageRelationsCursor | undefined
      do {
        signal?.throwIfAborted()
        const page = await rows.readMessageRelationsPage({
          sessionId,
          threadId,
          expectedRevision: revision,
          limit: 200,
          cursor,
          selector:
            scope === 'active-path'
              ? { kind: 'selected-path', messageId: root }
              : { kind: 'subtree', rootMessageId: root },
        })
        if (!page || page.status !== 'ready') throw new Error('Attachment references are unavailable')
        for (const row of page.rows) {
          if (!Array.isArray(row.facts.imageStorageKeys) || !Array.isArray(row.facts.attachmentOwnershipIds))
            throw new Error('Attachment facts are unavailable')
          yield {
            sessionId,
            threadId,
            messageId: row.messageId,
            revision,
            files: row.facts.seedAttachments ?? [],
            imageStorageKeys: row.facts.imageStorageKeys,
            attachmentOwnershipIds: row.facts.attachmentOwnershipIds,
          }
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor)
    }
    threadCursor = threads.nextCursor ?? undefined
  } while (threadCursor)
  signal?.throwIfAborted()
  const current = await rows.readCommit(sessionId)
  if (current?.revision !== revision) throw new SessionRowConflictError(sessionId, revision, current?.revision ?? null)
}
