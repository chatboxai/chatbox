import { throwIfAborted } from '../../utils/abort'
import type { SessionRowRelationsPort } from '../../ports/session-row-relations'
import type { SessionHeaderRead } from '../../ports/session-row-repository'
import { SessionRowConflictError } from '../../ports/session-row-store'
import type { SessionSearchWindowRequest } from '../../ports/session-search-source'
import { DEFAULT_TRANSCRIPT_PAGE_BYTES, type SessionTranscriptStorePort } from '../../ports/session-transcript-source'

type SearchRows = SessionRowRelationsPort & SessionTranscriptStorePort

export async function selectedSearchCandidates(
  rows: SearchRows,
  current: SessionHeaderRead,
  messageIds: readonly string[]
): Promise<string[]> {
  if (messageIds.length > 100) throw new RangeError('Too many search candidates')
  if (!messageIds.length) return []
  const metadata = await rows.readMessageMetadata({
    sessionId: current.header.id,
    messageIds: [...new Set(messageIds)],
    expectedRevision: current.revision,
  })
  if (!metadata || metadata.status !== 'ready') throw new Error('Search candidate projection is unavailable')
  return metadata.rows.filter((row) => row.selected).map((row) => row.messageId)
}

/** The caller holds the session command queue for this single read batch. */
export async function readRowSearchWindow(
  rows: SearchRows,
  current: SessionHeaderRead,
  request: SessionSearchWindowRequest
) {
  const { sessionId, cursor, messageId, signal } = request
  if (cursor && messageId !== undefined) throw new Error('Conflicting search origins')
  throwIfAborted(signal)
  if (cursor) {
    if (
      cursor.sessionId !== sessionId ||
      cursor.direction !== 'before' ||
      cursor.scope !== 'transcript' ||
      cursor.limit !== 50 ||
      cursor.maxBytes !== DEFAULT_TRANSCRIPT_PAGE_BYTES ||
      !Number.isSafeInteger(cursor.revision) ||
      cursor.revision < 0 ||
      cursor.revision > current.revision
    ) {
      throw new Error('Invalid search continuation')
    }
    const changed = () => new SessionRowConflictError(sessionId, cursor.revision, current.revision)
    const state = await rows.readThreadState({
      sessionId,
      threadId: cursor.threadId,
      expectedRevision: current.revision,
    })
    throwIfAborted(signal)
    if (!state || state.status !== 'ready' || state.thread.threadOrder !== cursor.threadOrder) throw changed()
    if (cursor.messageId === null) {
      if (state.thread.rootMessageId !== null) throw changed()
    } else {
      const metadata = await rows.readMessageMetadata({
        sessionId,
        messageIds: [cursor.messageId],
        expectedRevision: current.revision,
      })
      throwIfAborted(signal)
      if (!metadata || metadata.status !== 'ready') throw new Error('Search cursor projection is unavailable')
      const anchor = metadata.rows.find((row) => row.messageId === cursor.messageId)
      if (!anchor?.selected || anchor.threadId !== cursor.threadId) throw changed()
    }
  }
  if (messageId !== undefined) {
    const selected = await selectedSearchCandidates(rows, current, [messageId])
    throwIfAborted(signal)
    if (!selected.includes(messageId)) return null
  }
  const page = await rows.readTranscriptWindow({
    sessionId,
    limit: messageId === undefined ? 50 : 1,
    maxBytes: DEFAULT_TRANSCRIPT_PAGE_BYTES,
    expectedRevision: current.revision,
    ...(cursor
      ? { cursor: { ...cursor, revision: current.revision } }
      : { origin: messageId === undefined ? 'tail' : { messageId } }),
  })
  throwIfAborted(signal)
  if (!page || page.revision !== current.revision) throw new Error('Search page is unavailable')
  return page
}
