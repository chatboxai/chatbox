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
import type { MessageRowMetadata } from '@chatbox/core/session/session-tree'
import {
  TRANSCRIPT_MESSAGES,
  TRANSCRIPT_THREADS,
  RELATION_CHILDREN,
  RELATION_BRANCH,
  THREAD_SUMMARY_ORDER,
  requestValue,
  readTranscriptTransaction,
  readTranscriptCommit,
  plainTranscriptThread,
} from './session-row-idb-transcript'
import {
  SESSION_ROW_THREAD_STORE,
  SESSION_ROW_MESSAGE_STORE,
  STATUS_INDEX,
  SELECTED_PAUSED,
  plainThreadRow,
  type PersistedThreadRow,
} from './session-row-idb-records'

export function idbRelationReader(tx: IDBTransaction, sessionId: string): SessionRelationReader {
  const store = tx.objectStore(TRANSCRIPT_MESSAGES)
  return {
    path: async (threadId, messageId, direction, limit) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 201) throw new Error('Invalid relation path limit')
      const result: MessageRowMetadata[] = []
      let id: string | null = messageId
      while (id !== null && result.length < limit) {
        const row: MessageRowMetadata | undefined = await requestValue(store.get([sessionId, id]))
        if (!row) {
          if (result.length) throw new Error('Missing message relationship')
          break
        }
        if (row.threadId !== threadId) throw new Error('Relation crosses a thread boundary')
        result.push(row)
        id = direction === 'ancestors' ? row.parentMessageId : row.activeChildId
      }
      return result
    },
    message: async (id) => (await requestValue<MessageRowMetadata | undefined>(store.get([sessionId, id]))) ?? null,
    status: async (threadId, options) => {
      const prefix = [options.status, sessionId, threadId]
      const range = IDBKeyRange.bound(
        options.afterId === undefined ? prefix : [...prefix, options.afterId],
        [...prefix, []],
        options.afterId !== undefined
      )
      const ids: string[] = []
      await new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(SESSION_ROW_MESSAGE_STORE).index(STATUS_INDEX).openKeyCursor(range)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) {
            resolve()
            return
          }
          const key = cursor.key
          if (!Array.isArray(key) || typeof key[3] !== 'string') {
            reject(new Error('Invalid message status index'))
            return
          }
          ids.push(key[3])
          if (ids.length === options.limit) resolve()
          else cursor.continue()
        }
      })
      const rows = await Promise.all(
        ids.map((id) => requestValue<MessageRowMetadata | undefined>(store.get([sessionId, id])))
      )
      return rows.map((row) => {
        if (!row) throw new Error('Message status metadata is missing')
        return row
      })
    },
    selectedFacts: async (threadId, options) => {
      const prefix = [sessionId, threadId, 1]
      const range = IDBKeyRange.bound(
        options.afterDepth === undefined ? prefix : [...prefix, options.afterDepth, []],
        [...prefix, []],
        options.afterDepth !== undefined
      )
      const result: Array<{ row: MessageRowMetadata; depth: number }> = []
      await new Promise<void>((resolve, reject) => {
        const request = store.index(SELECTED_PAUSED).openCursor(range)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor || result.length === options.limit) {
            resolve()
            return
          }
          const row = cursor.value as MessageRowMetadata & { selectedDepth: number }
          if (!Number.isSafeInteger(row.selectedDepth) || row.selectedDepth < 0) {
            reject(new Error('Invalid selected fact depth'))
            return
          }
          result.push({ row, depth: row.selectedDepth })
          cursor.continue()
        }
      })
      return result
    },
    children: async (threadId, selector, limit) => {
      const prefix = [
        sessionId,
        threadId,
        selector.parentMessageId ?? '',
        ...(selector.branchId !== undefined ? [selector.branchId] : []),
      ]
      const boundary = selector.boundary ? [...prefix, selector.boundary.seq, selector.boundary.messageId] : null
      const range = selector.reverse
        ? IDBKeyRange.bound(prefix, boundary ?? [...prefix, []], false, boundary !== null)
        : IDBKeyRange.bound(boundary ?? prefix, [...prefix, []], boundary !== null, false)
      const result: MessageRowMetadata[] = []
      await new Promise<void>((resolve, reject) => {
        const request = store
          .index(selector.branchId !== undefined ? RELATION_BRANCH : RELATION_CHILDREN)
          .openCursor(range, selector.reverse ? 'prev' : 'next')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          if (!request.result || result.length === limit) {
            resolve()
            return
          }
          result.push(request.result.value as MessageRowMetadata)
          request.result.continue()
        }
      })
      return result
    },
  }
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
    readMetadataSelection(request, commit, idbRelationReader(tx, request.sessionId))
  )
}
export function readIndexedDBRelations(db: IDBDatabase, request: SessionMessageRelationsRequest) {
  return withCommit(db, request, (tx, commit) =>
    readRelationsPage(request, commit, idbRelationReader(tx, request.sessionId))
  )
}
export function readIndexedDBThreadState(db: IDBDatabase, request: SessionThreadStateRequest) {
  return withCommit(db, request, async (tx, commit) => {
    const id = request.threadId ?? commit.record.activeThreadId
    const stored = await requestValue<PersistedThreadRow | undefined>(
      tx.objectStore(SESSION_ROW_THREAD_STORE).get([request.sessionId, id])
    )
    if (!stored) return null
    const thread = plainThreadRow(stored)
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
    readBranchPreviewFromMetadata(request, commit, idbRelationReader(tx, request.sessionId).message)
  )
}
