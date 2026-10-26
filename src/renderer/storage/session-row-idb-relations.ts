import { messageMetadata } from './session-row-idb-messages'
import { loadTreeLinks } from './session-row-idb-links'
import { threadLinksRelationReader, ThreadLinks } from '@chatbox/core/persistence'
import { MESSAGE_TREE, readTreeMessage, decodeTreeMetadata, type StoredTreeMetadata } from './session-row-idb-tree'
import {
  readMetadataSelection,
  readRelationsPage,
  readBranchPreviewFromMetadata,
  validateBranchPreviewRequest,
  type SessionRelationReader,
} from '@chatbox/core/persistence'
import type { SessionBranchPreviewRequest } from '@chatbox/core/ports'
import {
  SessionRowConflictError,
  type SessionMessageMetadataRequest,
  type SessionMessageRelationsRequest,
  type SessionThreadStateRequest,
  type SessionThreadPageRequest,
  type SessionRowCommit,
  type SessionTranscriptThread,
} from '@chatbox/core/ports'
import type { MessageRowMetadata, ThreadRow } from '@chatbox/core/session/session-tree'
import {
  TRANSCRIPT_THREADS,
  THREAD_SUMMARY_ORDER,
  requestValue,
  readTranscriptTransaction,
  readTranscriptCommit,
  plainTranscriptThread,
} from './session-row-idb-transcript'
import { SESSION_ROW_THREAD_STORE, SESSION_ROW_MESSAGE_STORE, STATUS_INDEX } from './session-row-idb-records'

export function idbRelationReader(tx: IDBTransaction, sessionId: string, revision: number): SessionRelationReader {
  return threadLinksRelationReader({
    message: async (id) => {
      const stored = await readTreeMessage(tx, sessionId, id)
      return stored && { ...messageMetadata(stored), facts: stored.facts }
    },
    thread: async (id) =>
      (await requestValue<ThreadRow | undefined>(tx.objectStore(SESSION_ROW_THREAD_STORE).get([sessionId, id]))) ??
      null,
    loadThreadLinks: (id) => loadTreeLinks(tx, sessionId, id, revision),
  })
}

async function withCommit<T>(
  db: IDBDatabase,
  request: { sessionId: string; expectedRevision?: number },
  work: (tx: IDBTransaction, commit: SessionRowCommit) => Promise<T>
): Promise<T | null> {
  return readTranscriptTransaction(db, async (tx) => {
    const commit = await readTranscriptCommit(tx, request.sessionId)
    if (request.expectedRevision !== undefined && request.expectedRevision !== (commit?.revision ?? null))
      throw new SessionRowConflictError(request.sessionId, request.expectedRevision, commit?.revision ?? null)
    return commit ? work(tx, commit) : null
  })
}
export function readIndexedDBMetadata(db: IDBDatabase, request: SessionMessageMetadataRequest) {
  return withCommit(db, request, (tx, commit) =>
    readMetadataSelection(request, commit, idbRelationReader(tx, request.sessionId, commit.revision))
  )
}
export function readIndexedDBRelations(db: IDBDatabase, request: SessionMessageRelationsRequest) {
  return withCommit(db, request, (tx, commit) =>
    readRelationsPage(request, commit, idbRelationReader(tx, request.sessionId, commit.revision))
  )
}
export function readIndexedDBThreadState(db: IDBDatabase, request: SessionThreadStateRequest) {
  return withCommit(db, request, async (tx, commit) => {
    const id = request.threadId ?? commit.record.activeThreadId
    const thread = await requestValue<ThreadRow | undefined>(
      tx.objectStore(SESSION_ROW_THREAD_STORE).get([request.sessionId, id])
    )
    if (!thread) return null
    return thread.summary
      ? { ...commit, status: 'ready' as const, thread: { ...thread, summary: thread.summary } }
      : { ...commit, status: 'projection-unavailable' as const, messageIds: [], threadIds: [id] }
  })
}
export function readIndexedDBThreadSummaries(db: IDBDatabase, request: SessionThreadPageRequest) {
  if (
    !Number.isSafeInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > 200 ||
    (request.cursor &&
      (request.cursor.sessionId !== request.sessionId ||
        !Number.isSafeInteger(request.cursor.offset) ||
        request.cursor.offset < 0))
  )
    throw new Error('Invalid thread summary page')
  return withCommit(
    db,
    { sessionId: request.sessionId, expectedRevision: request.cursor?.revision },
    async (tx, commit) => {
      const threads: SessionTranscriptThread[] = []
      await new Promise<void>((resolve, reject) => {
        const cursor = tx
          .objectStore(TRANSCRIPT_THREADS)
          .index(THREAD_SUMMARY_ORDER)
          .openCursor(IDBKeyRange.bound([request.sessionId], [request.sessionId, []]))
        let skip = request.cursor?.offset ?? 0
        cursor.onerror = () => reject(cursor.error)
        cursor.onsuccess = () => {
          if (!cursor.result || threads.length > request.limit) {
            resolve()
            return
          }
          if (skip) {
            const count = skip
            skip = 0
            cursor.result.advance(count)
            return
          }
          threads.push(plainTranscriptThread(cursor.result.value)!)
          cursor.result.continue()
        }
      })
      return {
        ...commit,
        threads: threads.slice(0, request.limit),
        nextCursor:
          threads.length > request.limit
            ? {
                sessionId: request.sessionId,
                revision: commit.revision,
                offset: (request.cursor?.offset ?? 0) + request.limit,
              }
            : null,
      }
    }
  )
}

export function readIndexedDBBranchPreview(db: IDBDatabase, request: SessionBranchPreviewRequest) {
  validateBranchPreviewRequest(request)
  return withCommit(db, request, (tx, commit) =>
    readBranchPreviewFromMetadata(request, commit, (id) => readTreeMessage(tx, request.sessionId, id))
  )
}
