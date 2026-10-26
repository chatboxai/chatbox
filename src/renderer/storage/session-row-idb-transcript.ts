import { deriveMessageFacts } from '@chatbox/core/session/session-tree'
import { loadTreeLinks } from './session-row-idb-links'
import { MESSAGE_TREE, encodeTreeMetadata, readTreeMessage, type TreeMetadata } from './session-row-idb-tree'
import { v4 as uuid } from 'uuid'
import {
  readBranchMessagesPage,
  validateBranchMessagesRequest,
  readTranscriptPage,
  transcriptOrder,
  transcriptThread,
  assertTranscriptRevision,
  validateTranscriptRequest,
  type TranscriptMessageMetadata,
  type SessionTranscriptReader,
} from '@chatbox/core/persistence'
import type {
  SessionBranchMessagesRequest,
  SessionRowCommit,
  SessionThreadRead,
  SessionThreadRequest,
  SessionTranscriptPage,
  SessionTranscriptRequest,
  SessionTranscriptThread,
} from '@chatbox/core/ports'
import { SessionRowConflictError } from '@chatbox/core/ports'
import type { MessageRow, ThreadRow } from '@chatbox/core/session/session-tree'
import { readStoredMessage, type StoredMessageRow } from './session-row-idb-messages'
import {
  REVISION_HEAD_THREAD_ID,
  ROW_STORES,
  SESSION_ROW_MESSAGE_STORE,
  SESSION_ROW_THREAD_STORE,
  SESSION_INDEX,
  isRevisionHeadRow,
  type RevisionHeadRow,
} from './session-row-idb-records'

export const TRANSCRIPT_THREADS = 'transcriptThreads'
export const THREAD_SUMMARY_ORDER = 'bySummaryOrder'
const NONEMPTY_ORDER = 'bySessionNonemptyOrder'
interface StoredTranscriptThread extends SessionTranscriptThread {
  nonempty: number
  order: number
  searchOrder: number
}

export function putTranscriptThread(tx: IDBTransaction, row: ThreadRow): void {
  if (isRevisionHeadRow(row)) return
  tx.objectStore(TRANSCRIPT_THREADS).put({
    ...transcriptThread(row),
    nonempty: Number(row.rootMessageId !== null),
    order: transcriptOrder(row.threadOrder),
    searchOrder: row.threadOrder === -1 ? -Number.MAX_SAFE_INTEGER : -row.threadOrder,
  } satisfies StoredTranscriptThread)
}

export function putTranscriptMessage(tx: IDBTransaction, row: StoredMessageRow, payloadBytes?: number): void {
  const { message, ...metadata } = row
  tx.objectStore(MESSAGE_TREE).put(
    encodeTreeMetadata({
      ...metadata,
      facts: metadata.facts ?? deriveMessageFacts(message),
      tokenPayloadId: uuid(),
      payloadBytes: payloadBytes ?? new TextEncoder().encode(JSON.stringify(message)).length,
    })
  )
}

export function requestValue<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error)
  })
}

export function plainTranscriptThread(row: StoredTranscriptThread | undefined): SessionTranscriptThread | null {
  if (!row) return null
  const { order: _order, nonempty: _nonempty, searchOrder: _searchOrder, ...thread } = row
  return thread
}

async function readRevision(tx: IDBTransaction, sessionId: string): Promise<number | null> {
  const head = await requestValue<RevisionHeadRow | undefined>(
    tx.objectStore(SESSION_ROW_THREAD_STORE).get([sessionId, REVISION_HEAD_THREAD_ID])
  )
  return head?.commitRevision ?? null
}

export async function readTranscriptCommit(tx: IDBTransaction, sessionId: string): Promise<SessionRowCommit | null> {
  const head = await requestValue<RevisionHeadRow | undefined>(
    tx.objectStore(SESSION_ROW_THREAD_STORE).get([sessionId, REVISION_HEAD_THREAD_ID])
  )
  if (head?.sessionRecord) {
    if (
      !Number.isSafeInteger(head.commitRevision) ||
      head.commitRevision < 1 ||
      head.sessionRecord.id !== sessionId ||
      typeof head.sessionRecord.activeThreadId !== 'string' ||
      !head.sessionRecord.activeThreadId
    )
      throw new Error('Transcript commit metadata is inconsistent')
    return { record: head.sessionRecord, revision: head.commitRevision }
  }
  return null
}

function reader(tx: IDBTransaction, sessionId: string): SessionTranscriptReader {
  const threads = tx.objectStore(TRANSCRIPT_THREADS)
  return {
    thread: async (id) =>
      plainTranscriptThread(await requestValue<StoredTranscriptThread | undefined>(threads.get([sessionId, id]))),
    adjacent: async (thread, direction) => {
      const lower = [sessionId, 1]
      const upper = [sessionId, 1, []]
      const key = thread ? [sessionId, 1, transcriptOrder(thread.threadOrder), thread.threadId] : null
      const range =
        direction === 'after'
          ? IDBKeyRange.bound(key ?? lower, upper, key !== null, false)
          : IDBKeyRange.bound(lower, key ?? upper, false, key !== null)
      const cursor = await requestValue<IDBCursorWithValue | null>(
        threads.index(NONEMPTY_ORDER).openCursor(range, direction === 'after' ? 'next' : 'prev')
      )
      return plainTranscriptThread(cursor?.value as StoredTranscriptThread | undefined)
    },
    isOnPath: async (row) => {
      const revision = await readRevision(tx, sessionId)
      const graph = await loadTreeLinks(tx, sessionId, row.threadId, revision ?? 0)
      const thread = await requestValue<ThreadRow | undefined>(
        tx.objectStore(SESSION_ROW_THREAD_STORE).get([sessionId, row.threadId])
      )
      return Boolean(thread && graph.isOnPath(row.messageId, thread.rootMessageId))
    },
    message: async (id) => await readTreeMessage(tx, sessionId, id),
    // Queue every read at once; awaiting each request serially costs a task hop per message.
    payloads: (ids) =>
      Promise.all(
        ids.map(async (id) => {
          const row = await requestValue<StoredMessageRow | undefined>(
            tx.objectStore(SESSION_ROW_MESSAGE_STORE).get([sessionId, id])
          )
          if (!row) throw new Error('Transcript payload is missing')
          return new Promise<MessageRow>((resolve, reject) => readStoredMessage(tx, row, resolve, reject))
        })
      ),
  }
}

export async function readTranscriptTransaction<T>(
  db: IDBDatabase,
  work: (tx: IDBTransaction) => Promise<T>,
  mode: IDBTransactionMode = 'readonly'
): Promise<T> {
  const tx = db.transaction(ROW_STORES, mode)
  let result: T
  let failure: unknown
  const completed = new Promise<T>((resolve, reject) => {
    tx.oncomplete = () => resolve(result)
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error)
  })
  work(tx)
    .then((value) => {
      result = value
    })
    .catch((error) => {
      failure = error
      tx.abort()
    })
  return completed
}

export function readIndexedDBCommit(db: IDBDatabase, sessionId: string): Promise<SessionRowCommit | null> {
  return readTranscriptTransaction(db, (tx) => readTranscriptCommit(tx, sessionId))
}

export function readIndexedDBThread(db: IDBDatabase, request: SessionThreadRequest): Promise<SessionThreadRead | null> {
  return readTranscriptTransaction(db, async (tx) => {
    const commit = await readTranscriptCommit(tx, request.sessionId)
    const revision = commit?.revision ?? (await readRevision(tx, request.sessionId))
    if (request.expectedRevision !== undefined && request.expectedRevision !== revision)
      throw new SessionRowConflictError(request.sessionId, request.expectedRevision, revision)
    if (!commit) return null
    const thread = await reader(tx, request.sessionId).thread(request.threadId ?? commit.record.activeThreadId)
    return thread ? { ...commit, thread } : null
  })
}

export function readIndexedDBTranscript(
  db: IDBDatabase,
  request: SessionTranscriptRequest
): Promise<SessionTranscriptPage | null> {
  validateTranscriptRequest(request)
  return readTranscriptTransaction(db, async (tx) => {
    const commit = await readTranscriptCommit(tx, request.sessionId)
    assertTranscriptRevision(request, commit?.revision ?? (await readRevision(tx, request.sessionId)))
    return commit ? readTranscriptPage(request, commit, reader(tx, request.sessionId)) : null
  })
}

export function readIndexedDBBranch(db: IDBDatabase, request: SessionBranchMessagesRequest) {
  validateBranchMessagesRequest(request)
  return readTranscriptTransaction(db, async (tx) => {
    const commit = await readTranscriptCommit(tx, request.sessionId)
    const expected = request.expectedRevision ?? request.cursor?.revision
    const revision = commit?.revision ?? (await readRevision(tx, request.sessionId))
    if (expected !== undefined && expected !== revision)
      throw new SessionRowConflictError(request.sessionId, expected, revision)
    return commit ? readBranchMessagesPage(request, commit, reader(tx, request.sessionId)) : null
  })
}
