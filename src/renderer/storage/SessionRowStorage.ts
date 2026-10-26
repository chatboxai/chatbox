import { MESSAGE_TREE } from './session-row-idb-tree'
import { prefetchTreeLinks, treeLinksCache } from './session-row-idb-links'
import { stageIndexedDBImportRows, resumeIndexedDBImportRows } from './session-row-idb-import'
import type { SessionBranchPreviewRequest } from '@chatbox/core/ports'
import { readIndexedDBTokenCache, acceptIndexedDBTokenCache } from './session-row-idb-token-cache'
import type { SessionTokenCacheRequest, SessionTokenCacheResult } from '@chatbox/core/ports'
import { applyIndexedDBLocalMutation } from './session-row-idb-local-mutation'
import {
  readIndexedDBMetadata,
  readIndexedDBBranchPreview,
  readIndexedDBRelations,
  readIndexedDBThreadState,
  readIndexedDBThreadSummaries,
} from './session-row-idb-relations'
import type {
  SessionMessageMetadataRequest,
  SessionBranchMessagesRequest,
  SessionRowMutationResult,
  SessionMessageRelationsRequest,
  SessionThreadStateRequest,
  SessionThreadPageRequest,
} from '@chatbox/core/ports'
import {
  putTranscriptThread,
  readIndexedDBCommit,
  readIndexedDBThread,
  readIndexedDBTranscript,
  readIndexedDBBranch,
  TRANSCRIPT_THREADS,
} from './session-row-idb-transcript'
import type {
  SessionThreadRequest,
  SessionThreadRead,
  SessionTranscriptRequest,
  SessionTranscriptPage,
} from '@chatbox/core/ports'
import { iterateIndexedDBRows, stageIndexedDBRows } from './session-row-idb-transfer'
import type { SessionRowIterationRequest } from '@chatbox/core/ports'
import {
  readStoredMessage,
  putStoredMessages,
  deleteStoredMessage,
  type StoredMessageRow,
} from './session-row-idb-messages'
import {
  SESSION_ROW_DB_NAME,
  SESSION_ROW_THREAD_STORE,
  SESSION_ROW_MESSAGE_STORE,
  SESSION_ROW_TOKEN_CACHE_STORE,
  SESSION_INDEX,
  STATUS_INDEX,
  ROW_STORES,
  REVISION_HEAD_THREAD_ID,
  type RevisionHeadRow,
  isRevisionHeadRow,
  storedRevision,
  revisionHead,
  revisionTombstone,
  readStoredCommit,
} from './session-row-idb-records'
import { assertSessionReadRevision, validateSessionMessagesRequest } from '@chatbox/core/persistence'
import {
  type GeneratingMessageRef,
  type SessionMessagesRequest,
  type SessionMessagesSnapshot,
  SessionRowConflictError,
  type SessionRowCommit,
  type SessionRowSnapshot,
  SessionRowStoreError,
  type SessionRowStoreOperation,
  type SessionRowStorePort,
  type SessionRows,
  type SessionRowsDiff,
} from '@chatbox/core/ports'
import type { MessageRow, MessageRowStatus, ThreadRow } from '@chatbox/core/session/session-tree'
import { openSessionRowDatabase } from './session-row-idb-schema'

export { SESSION_ROW_DB_NAME, SESSION_ROW_THREAD_STORE, SESSION_ROW_MESSAGE_STORE } from './session-row-idb-records'

function assertCommit(sessionId: string, rows: SessionRows, commit: SessionRowCommit): void {
  if (!Number.isSafeInteger(commit.revision) || commit.revision <= 0) {
    throw new SessionRowStoreError('write-rows', new Error('commit has an invalid revision'), sessionId)
  }
  const activeRows = rows.threads.filter((thread) => thread.threadOrder === -1)
  if (
    activeRows.length !== 1 ||
    commit.record.id !== sessionId ||
    commit.record.activeThreadId !== activeRows[0].threadId
  ) {
    throw new SessionRowStoreError('write-rows', new Error('commit does not match the active thread'), sessionId)
  }
}

function assertSessionId(operation: SessionRowStoreOperation, sessionId: string): void {
  if (!sessionId) {
    throw new SessionRowStoreError(operation, new Error('rows are missing a sessionId'))
  }
}

function assertThreadRow(operation: SessionRowStoreOperation, sessionId: string, row: ThreadRow): void {
  if (!row.sessionId || !row.threadId) {
    throw new SessionRowStoreError(operation, new Error('thread row is missing an id'), sessionId)
  }
  if (row.sessionId !== sessionId) {
    throw new SessionRowStoreError(
      operation,
      new Error(`thread ${row.threadId} belongs to session ${row.sessionId}`),
      sessionId
    )
  }
  if (row.threadId === REVISION_HEAD_THREAD_ID) {
    throw new SessionRowStoreError(operation, new Error('thread row uses the reserved revision-head id'), sessionId)
  }
}

function assertMessageRow(
  operation: SessionRowStoreOperation,
  sessionId: string,
  row: Omit<MessageRow, 'message'>
): void {
  if (!row.sessionId || !row.threadId || !row.messageId) {
    throw new SessionRowStoreError(operation, new Error('message row is missing an id'), sessionId)
  }
  if (row.sessionId !== sessionId) {
    throw new SessionRowStoreError(
      operation,
      new Error(`message ${row.messageId} belongs to session ${row.sessionId}`),
      sessionId
    )
  }
}

/**
 * Upper bound of a `byStatus` prefix: array keys sort after string keys, so
 * `[status, []]` is greater than every `[status, sessionId, ...]` entry.
 */
function statusKeyRange(status: MessageRowStatus): IDBKeyRange {
  return IDBKeyRange.bound([status], [status, []])
}

function clearSessionRows(store: IDBObjectStore, sessionId: string, onDone: () => void): void {
  const request = store.index(SESSION_INDEX).openKeyCursor(IDBKeyRange.only(sessionId))
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) {
      onDone()
      return
    }
    if (store.name === SESSION_ROW_MESSAGE_STORE)
      deleteStoredMessage(store.transaction, sessionId, (cursor.primaryKey as string[])[1])
    else store.delete(cursor.primaryKey)
    cursor.continue()
  }
}

/**
 * Desktop/web `SessionRowStorePort`, backed by its own `chatbox-messages`
 * database so message rows never share a transaction with the session record.
 * Every mutation of one session runs in a single `readwrite` transaction, and
 * rows are validated before that transaction opens so a rejected write leaves
 * the stored rows byte-identical.
 */
export class IndexedDBSessionRowStore implements SessionRowStorePort {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null
  private openGeneration = 0

  close(): void {
    this.openGeneration += 1
    this.db?.close()
    this.db = null
    this.initPromise = null
  }

  initialize(): Promise<void> {
    if (!this.initPromise) {
      const generation = this.openGeneration
      this.initPromise = this.openDatabase(generation).catch((error: unknown) => {
        if (generation === this.openGeneration) this.initPromise = null
        throw error
      })
    }
    return this.initPromise
  }

  private async openDatabase(generation = this.openGeneration): Promise<void> {
    const db = await openSessionRowDatabase(
      SESSION_ROW_DB_NAME,
      () => generation === this.openGeneration,
      (db) => {
        if (this.db === db) this.close()
      }
    )
    if (generation !== this.openGeneration) {
      db.close()
      throw new Error('Session row database opening was canceled')
    }
    this.db = db
  }

  private async ensureDatabase(operation: SessionRowStoreOperation, sessionId?: string): Promise<IDBDatabase> {
    try {
      await this.initialize()
    } catch (error) {
      throw new SessionRowStoreError(operation, error, sessionId)
    }
    const db = this.db
    if (!db) {
      throw new SessionRowStoreError(operation, new Error('session row database is not open'), sessionId)
    }
    return db
  }

  private async runWrite(
    operation: SessionRowStoreOperation,
    sessionId: string,
    storeNames: string[],
    work: (tx: IDBTransaction, fail: (error: unknown) => void) => void
  ): Promise<IDBDatabase> {
    const db = await this.ensureDatabase(operation, sessionId)
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite')
      let failure: unknown = null
      let aborting = false
      const fail = (error: unknown) => {
        if (aborting) return
        aborting = true
        failure = error
        tx.abort()
      }

      tx.oncomplete = () => {
        if (operation !== 'apply-diff') treeLinksCache(db).invalidate(sessionId)
        resolve(db)
      }
      tx.onerror = () =>
        reject(
          failure instanceof SessionRowConflictError
            ? failure
            : new SessionRowStoreError(operation, failure ?? tx.error, sessionId)
        )
      tx.onabort = () =>
        reject(
          failure instanceof SessionRowConflictError
            ? failure
            : new SessionRowStoreError(operation, failure ?? tx.error, sessionId)
        )

      try {
        work(tx, fail)
      } catch (error) {
        fail(error)
      }
    })
  }

  async *iterateRows(request: SessionRowIterationRequest) {
    yield* iterateIndexedDBRows(await this.ensureDatabase('read-rows', request.sessionId), request)
  }

  async stageRows(commit: SessionRowCommit, expectedRevision: number | null) {
    const captured = structuredClone(commit)
    return stageIndexedDBRows(await this.ensureDatabase('write-rows', captured.record.id), captured, expectedRevision)
  }

  async stageImportRows(commit: SessionRowCommit, expectedRevision: number | null, jobId: string) {
    const captured = structuredClone(commit)
    return stageIndexedDBImportRows(
      await this.ensureDatabase('write-rows', captured.record.id),
      captured,
      expectedRevision,
      jobId
    )
  }

  async resumeImportRows(candidateId: string) {
    return resumeIndexedDBImportRows(await this.ensureDatabase('write-rows'), candidateId)
  }

  async readMessageMetadata(request: SessionMessageMetadataRequest) {
    return readIndexedDBMetadata(await this.ensureDatabase('read-message-metadata', request.sessionId), request)
  }
  async readMessageRelationsPage(request: SessionMessageRelationsRequest) {
    return readIndexedDBRelations(await this.ensureDatabase('read-message-relations', request.sessionId), request)
  }
  async readThreadState(request: SessionThreadStateRequest) {
    return readIndexedDBThreadState(await this.ensureDatabase('read-thread', request.sessionId), request)
  }
  async readThreadSummariesPage(request: SessionThreadPageRequest) {
    return readIndexedDBThreadSummaries(await this.ensureDatabase('read-thread-page', request.sessionId), request)
  }

  async readCommit(sessionId: string): Promise<SessionRowCommit | null> {
    return readIndexedDBCommit(await this.ensureDatabase('read-commit', sessionId), sessionId)
  }

  async readThread(request: SessionThreadRequest): Promise<SessionThreadRead | null> {
    return readIndexedDBThread(await this.ensureDatabase('read-thread', request.sessionId), request)
  }

  async prefetchThreadLinks(request: SessionThreadRequest & { signal?: AbortSignal }): Promise<void> {
    const db = await this.ensureDatabase('read-thread', request.sessionId)
    const state = await this.readThread(request)
    if (!state) return
    await prefetchTreeLinks(
      db,
      request.sessionId,
      state.thread.threadId,
      state.thread.rootMessageId,
      state.revision,
      request.signal
    )
  }

  async readTranscriptWindow(request: SessionTranscriptRequest): Promise<SessionTranscriptPage | null> {
    return readIndexedDBTranscript(await this.ensureDatabase('read-transcript', request.sessionId), request)
  }

  async readBranchPreview(request: SessionBranchPreviewRequest) {
    return readIndexedDBBranchPreview(await this.ensureDatabase('read-transcript', request.sessionId), request)
  }

  async readBranchMessagesPage(request: SessionBranchMessagesRequest) {
    return readIndexedDBBranch(await this.ensureDatabase('read-transcript', request.sessionId), request)
  }

  async readSnapshot(sessionId: string): Promise<SessionRowSnapshot | null> {
    const db = await this.ensureDatabase('read-rows', sessionId)
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ROW_STORES, 'readonly')
      const threadRequest = tx.objectStore(SESSION_ROW_THREAD_STORE).index(SESSION_INDEX).getAll(sessionId)
      const messageRequest = tx.objectStore(SESSION_ROW_MESSAGE_STORE).index(SESSION_INDEX).getAll(sessionId)
      const messages: MessageRow[] = []
      messageRequest.onsuccess = () => {
        for (const [index, row] of (messageRequest.result as StoredMessageRow[]).entries())
          readStoredMessage(
            tx,
            row,
            (message) => {
              messages[index] = message
            },
            (error) => {
              reject(error)
              tx.abort()
            }
          )
      }

      tx.oncomplete = () => {
        const storedThreads = threadRequest.result as Array<ThreadRow | RevisionHeadRow>
        const head = storedThreads.find(isRevisionHeadRow)
        const persisted = storedThreads.filter((row): row is ThreadRow => !isRevisionHeadRow(row))
        if (persisted.length === 0 && messages.length === 0) {
          resolve(null)
          return
        }
        try {
          const commit = readStoredCommit(sessionId, persisted, head)
          resolve({ rows: { sessionId, threads: persisted, messages }, ...commit })
        } catch (error) {
          reject(new SessionRowStoreError('read-rows', error, sessionId))
        }
      }
      tx.onerror = () => reject(new SessionRowStoreError('read-rows', tx.error, sessionId))
      tx.onabort = () => reject(new SessionRowStoreError('read-rows', tx.error, sessionId))
    })
  }

  async readTokenCache(request: SessionTokenCacheRequest) {
    return readIndexedDBTokenCache(await this.ensureDatabase('read-messages', request.sessionId), request)
  }
  async acceptTokenCache(results: readonly SessionTokenCacheResult[]) {
    return acceptIndexedDBTokenCache(await this.ensureDatabase('read-messages'), results)
  }

  async readMessages(request: SessionMessagesRequest): Promise<SessionMessagesSnapshot | null> {
    try {
      validateSessionMessagesRequest(request)
    } catch (error) {
      throw new SessionRowStoreError('read-messages', error, request.sessionId)
    }
    return this.readCommittedSelection('read-messages', request, (tx, commit, finish, fail) => {
      const ids = [...new Set(request.messageIds)]
      this.readSelectedRows(tx, request.sessionId, ids, (messages) => finish({ ...commit, messages }), fail)
    })
  }

  private async readCommittedSelection<Result>(
    operation: SessionRowStoreOperation,
    request: { sessionId: string; expectedRevision?: number },
    select: (
      tx: IDBTransaction,
      commit: SessionRowCommit,
      finish: (result: Result) => void,
      fail: (error: unknown) => void
    ) => void
  ): Promise<Result | null> {
    const db = await this.ensureDatabase(operation, request.sessionId)
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ROW_STORES, 'readonly')
      let result: Result | null = null
      let failure: unknown
      const fail = (error: unknown) => {
        failure = error
        tx.abort()
      }
      const read = tx.objectStore(SESSION_ROW_THREAD_STORE).get([request.sessionId, REVISION_HEAD_THREAD_ID])
      read.onerror = () => fail(read.error)
      read.onsuccess = () => {
        try {
          const head = read.result as RevisionHeadRow | undefined
          assertSessionReadRevision(request, head?.commitRevision ?? null)
          if (!head?.sessionRecord) return
          if (
            !Number.isSafeInteger(head.commitRevision) ||
            head.commitRevision < 1 ||
            head.sessionRecord.id !== request.sessionId ||
            !head.sessionRecord.activeThreadId
          )
            throw new Error('Message selection commit metadata is inconsistent')
          const commit = { record: head.sessionRecord, revision: head.commitRevision }
          select(
            tx,
            commit,
            (selected) => {
              result = selected
            },
            fail
          )
        } catch (error) {
          fail(error)
        }
      }
      tx.oncomplete = () => resolve(result)
      const rejectRead = () => {
        const error = failure ?? tx.error
        reject(
          error instanceof SessionRowConflictError
            ? error
            : new SessionRowStoreError(operation, error, request.sessionId)
        )
      }
      tx.onerror = rejectRead
      tx.onabort = rejectRead
    })
  }

  private readSelectedRows(
    tx: IDBTransaction,
    sessionId: string,
    ids: string[],
    finish: (rows: MessageRow[]) => void,
    fail: (error: unknown) => void
  ): void {
    if (ids.length === 0) {
      finish([])
      return
    }
    const rows = new Map<string, MessageRow>()
    let remaining = ids.length
    for (const id of ids) {
      const read = tx.objectStore(SESSION_ROW_MESSAGE_STORE).get([sessionId, id])
      read.onsuccess = () => {
        try {
          const complete = (row?: MessageRow) => {
            if (row) {
              assertMessageRow('read-messages', sessionId, row)
              if (row.messageId !== id) throw new Error('Message selection returned an unexpected id')
              rows.set(id, row)
            }
            remaining -= 1
            if (remaining === 0)
              finish(
                ids.flatMap((key) => {
                  const row = rows.get(key)
                  return row ? [row] : []
                })
              )
          }
          const row = read.result as StoredMessageRow | undefined
          if (row) readStoredMessage(tx, row, complete, fail)
          else complete()
        } catch (error) {
          fail(error)
        }
      }
    }
  }

  async writeRows(snapshot: SessionRowSnapshot, expectedRevision?: number | null): Promise<void> {
    const { rows, record, revision } = snapshot
    const sessionId = rows.sessionId
    assertSessionId('write-rows', sessionId)
    assertCommit(sessionId, rows, { record, revision })
    for (const thread of rows.threads) {
      assertThreadRow('write-rows', sessionId, thread)
    }
    for (const message of rows.messages) {
      assertMessageRow('write-rows', sessionId, message)
    }

    const projected = rows.messages
    await this.runWrite('write-rows', sessionId, ROW_STORES, (tx, fail) => {
      const threadStore = tx.objectStore(SESSION_ROW_THREAD_STORE)
      const messageStore = tx.objectStore(SESSION_ROW_MESSAGE_STORE)
      const replace = () => {
        tx.objectStore(TRANSCRIPT_THREADS).delete(IDBKeyRange.bound([sessionId], [sessionId, []]))
        tx.objectStore(MESSAGE_TREE).delete(IDBKeyRange.bound([sessionId], [sessionId, []]))
        tx.objectStore(SESSION_ROW_TOKEN_CACHE_STORE).delete(IDBKeyRange.bound([sessionId], [sessionId, []]))
        clearSessionRows(threadStore, sessionId, () => {
          clearSessionRows(messageStore, sessionId, () => {
            try {
              for (const thread of rows.threads) {
                threadStore.put(thread)
                putTranscriptThread(tx, thread)
              }
              putStoredMessages(
                tx,
                projected,
                () => threadStore.put(revisionHead(sessionId, { record, revision })),
                fail
              )
            } catch (error) {
              fail(error)
            }
          })
        })
      }
      if (expectedRevision === undefined) {
        replace()
        return
      }
      const revisionRequest = threadStore.get([sessionId, REVISION_HEAD_THREAD_ID])
      revisionRequest.onerror = () => fail(revisionRequest.error)
      revisionRequest.onsuccess = () => {
        const actualRevision = storedRevision(revisionRequest.result as ThreadRow | RevisionHeadRow | undefined)
        if (actualRevision !== expectedRevision) {
          fail(new SessionRowConflictError(sessionId, expectedRevision, actualRevision))
          return
        }
        replace()
      }
    })
  }

  async applyDiff(
    diff: SessionRowsDiff,
    commit: SessionRowCommit,
    expectedRevision?: number
  ): Promise<SessionRowMutationResult> {
    const sessionId = diff.sessionId
    assertSessionId('apply-diff', sessionId)
    if (expectedRevision === undefined) throw new Error('Row mutations require an expected revision')
    if (
      !Number.isSafeInteger(commit.revision) ||
      commit.revision <= 0 ||
      commit.record.id !== sessionId ||
      !commit.record.activeThreadId
    ) {
      throw new SessionRowStoreError('apply-diff', new Error('commit metadata is invalid'), sessionId)
    }
    for (const thread of diff.threads.upsert) {
      assertThreadRow('apply-diff', sessionId, thread)
    }
    for (const message of diff.messages.upsert) {
      assertMessageRow('apply-diff', sessionId, message)
    }

    for (const metadata of diff.messageMetadataUpsert ?? []) assertMessageRow('apply-diff', sessionId, metadata)
    let published: Awaited<ReturnType<typeof applyIndexedDBLocalMutation>> | undefined
    const db = await this.runWrite('apply-diff', sessionId, ROW_STORES, (tx, fail) => {
      const threadStore = tx.objectStore(SESSION_ROW_THREAD_STORE)
      const revisionRequest = threadStore.get([sessionId, REVISION_HEAD_THREAD_ID])
      revisionRequest.onerror = () => fail(revisionRequest.error)
      revisionRequest.onsuccess = () => {
        const actualRevision = storedRevision(revisionRequest.result as ThreadRow | RevisionHeadRow | undefined)
        if (expectedRevision !== undefined && actualRevision !== expectedRevision) {
          fail(new SessionRowConflictError(sessionId, expectedRevision, actualRevision))
          return
        }
        applyIndexedDBLocalMutation(tx, diff, commit, expectedRevision)
          .then((value) => {
            published = value
            threadStore.put(revisionHead(sessionId, commit))
          })
          .catch(fail)
      }
    })
    const { result, graphs } = published!
    treeLinksCache(db).committed(sessionId, expectedRevision, commit.revision, graphs)
    return result
  }

  async deleteRows(sessionId: string, expectedRevision?: number | null): Promise<void> {
    assertSessionId('delete-rows', sessionId)
    await this.runWrite('delete-rows', sessionId, ROW_STORES, (tx, fail) => {
      const threadStore = tx.objectStore(SESSION_ROW_THREAD_STORE)
      const remove = (revision: number | null) => {
        tx.objectStore(TRANSCRIPT_THREADS).delete(IDBKeyRange.bound([sessionId], [sessionId, []]))
        tx.objectStore(MESSAGE_TREE).delete(IDBKeyRange.bound([sessionId], [sessionId, []]))
        tx.objectStore(SESSION_ROW_TOKEN_CACHE_STORE).delete(IDBKeyRange.bound([sessionId], [sessionId, []]))
        clearSessionRows(threadStore, sessionId, () => {
          if (revision !== null) {
            threadStore.put(revisionTombstone(sessionId, revision + 1))
          }
          clearSessionRows(tx.objectStore(SESSION_ROW_MESSAGE_STORE), sessionId, () => {})
        })
      }
      const revisionRequest = threadStore.get([sessionId, REVISION_HEAD_THREAD_ID])
      revisionRequest.onerror = () => fail(revisionRequest.error)
      revisionRequest.onsuccess = () => {
        const actualRevision = storedRevision(revisionRequest.result as ThreadRow | RevisionHeadRow | undefined)
        if (expectedRevision !== undefined && actualRevision !== expectedRevision) {
          fail(new SessionRowConflictError(sessionId, expectedRevision, actualRevision))
          return
        }
        if (actualRevision === Number.MAX_SAFE_INTEGER) {
          fail(new Error('session row revision is exhausted'))
          return
        }
        remove(actualRevision)
      }
    })
  }

  async hasRows(sessionId: string): Promise<boolean> {
    const db = await this.ensureDatabase('has-rows', sessionId)
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ROW_STORES, 'readonly')
      let hasThread = false
      const threadRows = tx
        .objectStore(SESSION_ROW_THREAD_STORE)
        .index(SESSION_INDEX)
        .openKeyCursor(IDBKeyRange.only(sessionId))
      threadRows.onsuccess = () => {
        const cursor = threadRows.result
        if (!cursor) return
        const primaryKey = cursor.primaryKey
        if (Array.isArray(primaryKey) && primaryKey[1] !== REVISION_HEAD_THREAD_ID) {
          hasThread = true
          return
        }
        cursor.continue()
      }
      const messageCount = tx.objectStore(SESSION_ROW_MESSAGE_STORE).index(SESSION_INDEX).count(sessionId)

      tx.oncomplete = () => resolve(hasThread || messageCount.result > 0)
      tx.onerror = () => reject(new SessionRowStoreError('has-rows', tx.error, sessionId))
      tx.onabort = () => reject(new SessionRowStoreError('has-rows', tx.error, sessionId))
    })
  }

  async getRevision(sessionId: string): Promise<number | null> {
    const db = await this.ensureDatabase('get-revision', sessionId)
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_ROW_THREAD_STORE, 'readonly')
      const request = tx.objectStore(SESSION_ROW_THREAD_STORE).get([sessionId, REVISION_HEAD_THREAD_ID])

      tx.oncomplete = () => {
        resolve(storedRevision(request.result as ThreadRow | RevisionHeadRow | undefined))
      }
      tx.onerror = () => reject(new SessionRowStoreError('get-revision', tx.error, sessionId))
      tx.onabort = () => reject(new SessionRowStoreError('get-revision', tx.error, sessionId))
    })
  }

  async listSessionIds(): Promise<string[]> {
    const db = await this.ensureDatabase('list-session-ids')
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ROW_STORES, 'readonly')
      const sessionIds = new Set<string>()

      const threadRequest = tx.objectStore(SESSION_ROW_THREAD_STORE).index(SESSION_INDEX).openKeyCursor()
      threadRequest.onsuccess = () => {
        const cursor = threadRequest.result
        if (!cursor) return
        const primaryKey = cursor.primaryKey
        if (Array.isArray(primaryKey) && primaryKey[1] !== REVISION_HEAD_THREAD_ID) {
          sessionIds.add(String(cursor.key))
        }
        cursor.continue()
      }
      const messageRequest = tx
        .objectStore(SESSION_ROW_MESSAGE_STORE)
        .index(SESSION_INDEX)
        .openKeyCursor(null, 'nextunique')
      messageRequest.onsuccess = () => {
        const cursor = messageRequest.result
        if (!cursor) return
        if (typeof cursor.key === 'string') sessionIds.add(cursor.key)
        cursor.continue()
      }

      tx.oncomplete = () => resolve([...sessionIds].sort())
      tx.onerror = () => reject(new SessionRowStoreError('list-session-ids', tx.error))
      tx.onabort = () => reject(new SessionRowStoreError('list-session-ids', tx.error))
    })
  }

  async findMessagesByStatus(status: MessageRowStatus): Promise<GeneratingMessageRef[]> {
    const db = await this.ensureDatabase('find-messages-by-status')
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_TREE, 'readonly')
      const refs: GeneratingMessageRef[] = []
      const request = tx.objectStore(MESSAGE_TREE).index(STATUS_INDEX).openKeyCursor(statusKeyRange(status))

      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          return
        }
        const key = cursor.key
        if (Array.isArray(key) && key.length === 4) {
          refs.push({ sessionId: String(key[1]), threadId: String(key[2]), messageId: String(key[3]) })
        }
        cursor.continue()
      }

      tx.oncomplete = () => resolve(refs)
      tx.onerror = () => reject(new SessionRowStoreError('find-messages-by-status', tx.error))
      tx.onabort = () => reject(new SessionRowStoreError('find-messages-by-status', tx.error))
    })
  }
}
