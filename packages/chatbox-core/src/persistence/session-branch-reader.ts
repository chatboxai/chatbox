import type { SessionBranchMessagesPage, SessionBranchMessagesRequest } from '../ports/session-branch-source'
import { SessionRowConflictError, type SessionRowCommit } from '../ports/session-row-store'
import { DEFAULT_TRANSCRIPT_PAGE_BYTES } from '../ports/session-transcript-source'
import type { SessionTranscriptReader, TranscriptMessageMetadata } from './session-transcript-read'

export function validateBranchMessagesRequest(request: SessionBranchMessagesRequest): void {
  const { sessionId, firstMessageId, limit, maxBytes, cursor, expectedRevision } = request
  if (!sessionId || !firstMessageId || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new Error('A branch page requires a session, a first message, and a limit from 1 to 200')
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1))
    throw new Error('Invalid branch page byte budget')
  if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1))
    throw new Error('Invalid branch page revision')
  if (
    cursor &&
    (cursor.sessionId !== sessionId ||
      cursor.firstMessageId !== firstMessageId ||
      cursor.limit !== limit ||
      cursor.maxBytes !== (maxBytes ?? DEFAULT_TRANSCRIPT_PAGE_BYTES) ||
      !cursor.threadId ||
      !cursor.messageId ||
      !Number.isSafeInteger(cursor.revision) ||
      cursor.revision < 1 ||
      (expectedRevision !== undefined && expectedRevision !== cursor.revision))
  )
    throw new Error('Branch cursor does not match its request')
}

/** The enclosing store provides one transaction or a revision fence around these reads. */
export async function readBranchMessagesPage(
  request: SessionBranchMessagesRequest,
  commit: SessionRowCommit,
  reader: Pick<SessionTranscriptReader, 'thread' | 'message' | 'payloads'>
): Promise<SessionBranchMessagesPage> {
  validateBranchMessagesRequest(request)
  const expected = request.expectedRevision ?? request.cursor?.revision
  if (expected !== undefined && expected !== commit.revision)
    throw new SessionRowConflictError(request.sessionId, expected, commit.revision)
  if (commit.record.id !== request.sessionId) throw new Error('Branch commit belongs to another session')
  const first = await reader.message(request.firstMessageId)
  if (!first || first.sessionId !== request.sessionId || first.messageId !== request.firstMessageId)
    throw new Error('Branch first message was not found')
  const thread = await reader.thread(first.threadId)
  if (!thread || thread.sessionId !== request.sessionId || thread.threadId !== first.threadId)
    throw new Error('Branch thread was not found')
  if (request.cursor && request.cursor.threadId !== thread.threadId)
    throw new Error('Branch cursor belongs to another thread')
  const requireRow = async (id: string): Promise<TranscriptMessageMetadata> => {
    const row = id === first.messageId ? first : await reader.message(id)
    if (
      !row ||
      row.sessionId !== request.sessionId ||
      row.threadId !== thread.threadId ||
      row.messageId !== id ||
      !Number.isSafeInteger(row.siblingOrder) ||
      row.siblingOrder < 0 ||
      !Number.isSafeInteger(row.payloadBytes) ||
      row.payloadBytes < 0
    )
      throw new Error('Invalid branch message metadata')
    return row
  }
  let previous = request.cursor ? await requireRow(request.cursor.messageId) : null
  let nextId = previous ? previous.activeChildId : first.messageId
  const seen = new Set(previous ? [previous.messageId, first.messageId] : [])
  const selected: TranscriptMessageMetadata[] = []
  const maxBytes = request.maxBytes ?? DEFAULT_TRANSCRIPT_PAGE_BYTES
  let payloadBytes = 0
  while (nextId !== null && selected.length < request.limit) {
    if (seen.has(nextId)) throw new Error('Cyclic branch path')
    const row = await requireRow(nextId)
    if (previous && row.parentMessageId !== previous.messageId) throw new Error('Branch selected path is inconsistent')
    if (selected.length > 0 && payloadBytes + row.payloadBytes > maxBytes) break
    selected.push(row)
    payloadBytes += row.payloadBytes
    seen.add(row.messageId)
    previous = row
    nextId = row.activeChildId
  }
  const messages = selected.length ? await reader.payloads(selected.map((row) => row.messageId)) : []
  if (
    messages.length !== selected.length ||
    messages.some(
      (row, index) =>
        row.messageId !== selected[index].messageId ||
        row.message.id !== row.messageId ||
        row.sessionId !== request.sessionId ||
        row.threadId !== thread.threadId
    )
  )
    throw new Error('Branch payload selection is incomplete')
  const last = selected.at(-1)
  return {
    ...commit,
    threadId: thread.threadId,
    firstMessageId: request.firstMessageId,
    messages,
    payloadBytes,
    nextCursor:
      nextId !== null && last
        ? {
            sessionId: request.sessionId,
            threadId: thread.threadId,
            firstMessageId: request.firstMessageId,
            revision: commit.revision,
            limit: request.limit,
            maxBytes,
            messageId: last.messageId,
          }
        : null,
  }
}
