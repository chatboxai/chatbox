import { DEFAULT_TRANSCRIPT_PAGE_BYTES } from '../ports/session-transcript-source'
import { SessionRowConflictError, type SessionRowCommit } from '../ports/session-row-store'
import type {
  SessionTranscriptCursor,
  SessionTranscriptPage,
  SessionTranscriptRequest,
  SessionTranscriptThread,
} from '../ports/session-transcript-source'
import type { MessageRow, MessageRowMetadata, ThreadRow } from '../session/session-tree/types'

export interface TranscriptMessageMetadata extends MessageRowMetadata {
  tokenPayloadId?: string

  payloadBytes: number
  selectedDepth?: number
}

/** All calls belong to one transaction or are fenced by the enclosing reader's revision. */
export interface SessionTranscriptReader {
  thread(threadId: string): Promise<SessionTranscriptThread | null>
  adjacent(
    thread: SessionTranscriptThread | null,
    direction: 'before' | 'after'
  ): Promise<SessionTranscriptThread | null>
  message(messageId: string): Promise<TranscriptMessageMetadata | null>
  /** Metadata-only prefetch for one thread, including at most one byte-budget lookahead. */
  messagePath?(
    threadId: string,
    messageId: string,
    direction: 'before' | 'after',
    budget: { limit: number; remainingBytes: number; hasPrevious: boolean; skipFirst: boolean }
  ): Promise<TranscriptMessageMetadata[]>
  payloads(messageIds: string[]): Promise<MessageRow[]>
}

export function transcriptThread(thread: ThreadRow): SessionTranscriptThread {
  const { sessionId, threadId, seq, name, createdAt, rootMessageId, activeLeafMessageId } = thread
  return {
    sessionId,
    threadId,
    seq,
    name,
    createdAt,
    rootMessageId,
    activeLeafMessageId,
    ...(thread.summary ? { summary: thread.summary } : {}),
    ...(thread.control ? { control: thread.control } : {}),
  }
}

export { DEFAULT_TRANSCRIPT_PAGE_BYTES } from '../ports/session-transcript-source'

export function validateTranscriptRequest(request: SessionTranscriptRequest): void {
  const { cursor, origin, expectedRevision, limit } = request
  if (!request.sessionId || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new Error('A transcript page requires a session id and a limit from 1 to 200')
  if (request.maxBytes !== undefined && (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1))
    throw new Error('Invalid transcript byte budget')
  if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1))
    throw new Error('Invalid transcript revision')
  if (
    cursor &&
    (origin !== undefined ||
      cursor.sessionId !== request.sessionId ||
      cursor.limit !== limit ||
      cursor.maxBytes !== (request.maxBytes ?? DEFAULT_TRANSCRIPT_PAGE_BYTES) ||
      cursor.scope !== 'transcript' ||
      !cursor.threadId ||
      !Number.isSafeInteger(cursor.threadSeq) ||
      cursor.threadSeq < -1 ||
      !Number.isSafeInteger(cursor.revision) ||
      cursor.revision < 1 ||
      (cursor.direction !== 'before' && cursor.direction !== 'after') ||
      (cursor.messageId !== null && !cursor.messageId) ||
      (expectedRevision !== undefined && cursor.revision !== expectedRevision))
  )
    throw new Error('Transcript cursor does not match the requested page')
  if (
    origin !== undefined &&
    origin !== 'head' &&
    origin !== 'tail' &&
    (typeof origin !== 'object' ||
      origin === null ||
      (origin.align !== undefined && origin.align !== 'center') ||
      ('messageId' in origin
        ? !origin.messageId
        : !origin.threadId || (origin.edge !== 'head' && origin.edge !== 'tail')))
  )
    throw new Error('Invalid transcript origin')
}

export function assertTranscriptRevision(
  request: Pick<SessionTranscriptRequest, 'sessionId' | 'expectedRevision' | 'cursor'>,
  revision: number | null
): void {
  const expected = request.expectedRevision ?? request.cursor?.revision
  if (expected !== undefined && expected !== revision)
    throw new SessionRowConflictError(request.sessionId, expected, revision)
}

async function requireMessage(
  reader: Pick<SessionTranscriptReader, 'message'>,
  id: string,
  thread: SessionTranscriptThread
) {
  const row = await reader.message(id)
  if (
    !row ||
    row.sessionId !== thread.sessionId ||
    row.threadId !== thread.threadId ||
    row.messageId !== id ||
    !Number.isSafeInteger(row.seq) ||
    row.seq < 0
  )
    throw new Error(`Invalid transcript message ${id}`)
  return row
}

function verifyTarget(row: TranscriptMessageMetadata) {
  if (row.selected === false) throw new Error('Transcript target is outside the selected path')
  if (row.selected !== true) throw new Error('Transcript selected-path projection is unavailable')
}

interface SelectedPage {
  rows: TranscriptMessageMetadata[]
  payloadBytes: number
  threads: SessionTranscriptThread[]
  anchor: { threadId: string; messageId: string | null }
  older: SessionTranscriptCursor | null
  newer: SessionTranscriptCursor | null
}

async function selectPage(
  request: SessionTranscriptRequest,
  commit: SessionRowCommit,
  reader: SessionTranscriptReader,
  previousBytes?: number
): Promise<SelectedPage> {
  validateTranscriptRequest(request)
  assertTranscriptRevision(request, commit.revision)
  const origin = request.origin ?? 'tail'
  if (typeof origin === 'object' && origin.align === 'center') return selectCenteredPage(request, commit, reader)
  const direction =
    request.cursor?.direction ??
    (origin === 'tail' || (typeof origin === 'object' && 'edge' in origin && origin.edge === 'tail')
      ? 'before'
      : 'after')
  let thread: SessionTranscriptThread | null
  let nextId: string | null
  let skip = false
  if (request.cursor) {
    thread = await reader.thread(request.cursor.threadId)
    if (!thread || thread.seq !== request.cursor.threadSeq) throw new Error('Transcript cursor thread changed')
    nextId = request.cursor.messageId
    skip = nextId !== null
    if (nextId === null && thread.rootMessageId !== null) throw new Error('Transcript empty-thread cursor is invalid')
  } else if (typeof origin === 'object' && 'messageId' in origin) {
    const row = await reader.message(origin.messageId)
    if (!row) throw new Error('Transcript target was not found')
    thread = await reader.thread(row.threadId)
    if (!thread) throw new Error('Transcript target thread was not found')
    verifyTarget(row)
    nextId = row.messageId
  } else if (typeof origin === 'object') {
    thread = await reader.thread(origin.threadId)
    if (!thread) throw new Error('Transcript thread was not found')
    nextId = direction === 'after' ? thread.rootMessageId : thread.activeLeafMessageId
  } else {
    thread = await reader.adjacent(null, direction)
    if (!thread) thread = await reader.thread(commit.record.activeThreadId)
    if (!thread) throw new Error('Transcript active thread was not found')
    nextId = direction === 'after' ? thread.rootMessageId : thread.activeLeafMessageId
  }
  const anchor = { threadId: thread.threadId, messageId: nextId }
  const threads = new Map<string, SessionTranscriptThread>([[thread.threadId, thread]])
  const selected: TranscriptMessageMetadata[] = []
  let payloadBytes = 0
  const maxBytes = request.maxBytes ?? DEFAULT_TRANSCRIPT_PAGE_BYTES
  const explicitlyEmpty = !request.cursor && typeof origin === 'object' && 'threadId' in origin && nextId === null
  let previous: TranscriptMessageMetadata | null = null
  let buffered: TranscriptMessageMetadata[] = []
  let bufferedIndex = 0
  while (!explicitlyEmpty && selected.length < request.limit) {
    if (nextId === null) {
      const adjacent = await reader.adjacent(thread, direction)
      if (!adjacent) break
      thread = adjacent
      threads.set(thread.threadId, thread)
      nextId = direction === 'after' ? thread.rootMessageId : thread.activeLeafMessageId
      if (nextId === null) throw new Error('Transcript adjacency returned an empty thread')
      previous = null
      buffered = []
      bufferedIndex = 0
    }
    let row: TranscriptMessageMetadata
    if (reader.messagePath) {
      if (bufferedIndex === buffered.length) {
        buffered = await reader.messagePath(thread.threadId, nextId, direction, {
          limit: request.limit - selected.length + Number(skip),
          remainingBytes: maxBytes - payloadBytes - (previousBytes ?? 0),
          hasPrevious: selected.length > 0 || previousBytes !== undefined,
          skipFirst: skip,
        })
        bufferedIndex = 0
      }
      row = await requireMessage({ message: async () => buffered[bufferedIndex++] ?? null }, nextId, thread)
    } else row = await requireMessage(reader, nextId, thread)
    if (selected.some((item) => item.messageId === row.messageId)) throw new Error('Cyclic transcript path')
    if (
      previous &&
      (direction === 'after' ? row.parentMessageId !== previous.messageId : row.activeChildId !== previous.messageId)
    )
      throw new Error('Transcript selected path is inconsistent')
    if (
      (row.parentMessageId === null) !== (row.messageId === thread.rootMessageId) ||
      (row.activeChildId === null) !== (row.messageId === thread.activeLeafMessageId)
    )
      throw new Error('Transcript thread boundaries are inconsistent')
    const bytes = row.payloadBytes
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid transcript payload size')
    if (
      !skip &&
      (selected.length > 0 || previousBytes !== undefined) &&
      payloadBytes + bytes + (previousBytes ?? 0) > maxBytes
    )
      break
    previous = row
    nextId = direction === 'after' ? row.activeChildId : row.parentMessageId
    if (skip) skip = false
    else {
      selected.push(row)
      payloadBytes += bytes
    }
  }
  const rows = direction === 'before' ? selected.reverse() : selected
  const makeCursor = async (side: 'before' | 'after'): Promise<SessionTranscriptCursor | null> => {
    const row = side === 'before' ? rows[0] : rows.at(-1)
    const edgeThread = row ? threads.get(row.threadId)! : threads.get(anchor.threadId)!
    const hasLocal = row && (side === 'before' ? row.parentMessageId !== null : row.activeChildId !== null)
    if (!hasLocal && !(await reader.adjacent(edgeThread, side))) return null
    return {
      sessionId: request.sessionId,
      revision: commit.revision,
      threadId: edgeThread.threadId,
      threadSeq: edgeThread.seq,
      messageId: row?.messageId ?? null,
      direction: side,
      limit: request.limit,
      maxBytes,
      scope: 'transcript',
    }
  }
  if (origin === 'tail' && !request.cursor) {
    const active = await reader.thread(commit.record.activeThreadId)
    if (active && active.rootMessageId === null) threads.set(active.threadId, active)
  }
  return {
    rows,
    payloadBytes,
    threads: [...threads.values()].sort((a, b) => transcriptOrder(a.seq) - transcriptOrder(b.seq)),
    anchor,
    older: await makeCursor('before'),
    newer: await makeCursor('after'),
  }
}

/** Select metadata around the anchor before hydrating the final contiguous page. */
async function selectCenteredPage(
  request: SessionTranscriptRequest,
  commit: SessionRowCommit,
  reader: SessionTranscriptReader
): Promise<SelectedPage> {
  const origin = request.origin
  if (typeof origin !== 'object') throw new Error('A centered transcript page requires a target')
  const { align: _align, ...target } = origin
  const page = await selectPage({ ...request, origin: target, limit: 1 }, commit, reader)
  const threads = new Map(page.threads.map((thread) => [thread.threadId, thread]))
  const maxBytes = request.maxBytes ?? DEFAULT_TRANSCRIPT_PAGE_BYTES
  const extend = async (direction: 'before' | 'after', limit: number) => {
    const cursor = direction === 'before' ? page.older : page.newer
    if (!cursor || limit <= 0 || page.payloadBytes >= maxBytes) return
    const adjacent = await selectPage(
      { ...request, origin: undefined, cursor: { ...cursor, limit }, limit },
      commit,
      reader,
      page.payloadBytes
    )
    if (!adjacent.rows.length) return
    page.rows = direction === 'before' ? [...adjacent.rows, ...page.rows] : [...page.rows, ...adjacent.rows]
    page.payloadBytes += adjacent.payloadBytes
    if (direction === 'before') page.older = adjacent.older
    else page.newer = adjacent.newer
    for (const thread of adjacent.threads) threads.set(thread.threadId, thread)
  }
  if (page.rows.length) {
    await extend('before', Math.floor((request.limit - 1) / 2))
    await extend('after', request.limit - page.rows.length)
    await extend('before', request.limit - page.rows.length)
  }
  const cursorForRequest = (cursor: SessionTranscriptCursor | null) =>
    cursor ? { ...cursor, limit: request.limit } : null
  return {
    ...page,
    threads: [...threads.values()].sort((a, b) => transcriptOrder(a.seq) - transcriptOrder(b.seq)),
    older: cursorForRequest(page.older),
    newer: cursorForRequest(page.newer),
  }
}

export function transcriptOrder(seq: number): number {
  return seq === -1 ? Number.MAX_SAFE_INTEGER : seq
}

export async function readTranscriptPage(
  request: SessionTranscriptRequest,
  commit: SessionRowCommit,
  reader: SessionTranscriptReader
): Promise<SessionTranscriptPage> {
  const page = await selectPage(request, commit, reader)
  const messages = await reader.payloads(page.rows.map((row) => row.messageId))
  if (
    messages.length !== page.rows.length ||
    messages.some((row, index) => row.messageId !== page.rows[index].messageId)
  )
    throw new Error('Transcript payload selection is incomplete')
  const { rows: _rows, ...metadata } = page
  return { ...commit, ...metadata, messages, forks: page.rows.flatMap((row) => (row.fork ? [row.fork] : [])) }
}
