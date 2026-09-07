import {
  assertMessageWindowRevision,
  SessionMessageWindowTraversal,
  validateMessageWindowRequest,
  assertSessionReadRevision,
  validateSessionMessagesRequest,
  finishSessionContextRead,
  planSessionContextRead,
  SessionContextPathTraversal,
  validateSessionContextRequest,
  type SessionContextReadPlan,
} from '@chatbox/core/persistence'
import {
  type GeneratingMessageRef,
  type SessionMessageWindow,
  type SessionMessageWindowRequest,
  type SessionMessagesRequest,
  type SessionMessagesSnapshot,
  type SessionContextRequest,
  type SessionContextRows,
  SessionRowConflictError,
  type SessionRowCommit,
  type SessionRowSnapshot,
  SessionRowStoreError,
  type SessionRowStoreOperation,
  type SessionRowStorePort,
  type SessionRows,
  type SessionRowsDiff,
} from '@chatbox/core/ports'
import type { MessageRow, MessageRowStatus, SessionRecordV2, ThreadRow } from '@chatbox/core/session/session-tree'
import { reportDbOpenSucceeded, toDbOpenError, watchDbOpenBlocked, watchDbVersionChange } from './db-schema-guard'

export const SESSION_ROW_DB_NAME = 'chatbox-messages'
export const SESSION_ROW_THREAD_STORE = 'threads'
export const SESSION_ROW_MESSAGE_STORE = 'messages'

const DB_VERSION = 1
const SESSION_INDEX = 'bySession'
const STATUS_INDEX = 'byStatus'
const ROW_STORES = [SESSION_ROW_THREAD_STORE, SESSION_ROW_MESSAGE_STORE]
const REVISION_HEAD_THREAD_ID = '__chatbox_internal_revision_head__'

interface RevisionHeadRow {
  sessionId: string
  threadId: typeof REVISION_HEAD_THREAD_ID
  seq: -2
  commitRevision: number
  sessionRecord?: SessionRecordV2
}

interface PersistedThreadRow extends ThreadRow {
  sessionRecord?: SessionRecordV2
  commitRevision?: number
}

function isRevisionHeadRow(row: PersistedThreadRow | RevisionHeadRow): row is RevisionHeadRow {
  return row.seq === -2 && row.threadId === REVISION_HEAD_THREAD_ID
}

function storedRevision(row: PersistedThreadRow | RevisionHeadRow | undefined): number | null {
  return row && isRevisionHeadRow(row) ? row.commitRevision : null
}

function revisionHead(sessionId: string, commit: SessionRowCommit): RevisionHeadRow {
  return {
    sessionId,
    threadId: REVISION_HEAD_THREAD_ID,
    seq: -2,
    commitRevision: commit.revision,
    sessionRecord: commit.record,
  }
}

function revisionTombstone(sessionId: string, revision: number): RevisionHeadRow {
  return { sessionId, threadId: REVISION_HEAD_THREAD_ID, seq: -2, commitRevision: revision }
}

function plainThreadRow(row: PersistedThreadRow): ThreadRow {
  const { sessionRecord: _sessionRecord, commitRevision: _commitRevision, ...thread } = row
  return thread
}

function readStoredCommit(
  sessionId: string,
  threads: PersistedThreadRow[],
  head: RevisionHeadRow | undefined
): SessionRowCommit {
  const activeRows = threads.filter((thread) => thread.seq === -1)
  if (activeRows.length !== 1) {
    throw new Error(`session ${sessionId} must have exactly one active thread row`)
  }
  const active = activeRows[0]
  const record = head?.sessionRecord ?? active.sessionRecord
  const revision = head?.sessionRecord ? head.commitRevision : active.commitRevision
  if (!record || revision === undefined) {
    throw new Error(`session ${sessionId} rows have no commit metadata`)
  }
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error(`session ${sessionId} has an invalid commit revision`)
  }
  if (!head?.sessionRecord && head?.commitRevision !== undefined && head.commitRevision !== active.commitRevision) {
    throw new Error(`session ${sessionId} has inconsistent commit revisions`)
  }
  if (record.id !== sessionId || record.activeThreadId !== active.threadId) {
    throw new Error(`session ${sessionId} commit metadata does not match its active thread`)
  }
  return { record, revision }
}

function assertCommit(sessionId: string, rows: SessionRows, commit: SessionRowCommit): void {
  if (!Number.isSafeInteger(commit.revision) || commit.revision <= 0) {
    throw new SessionRowStoreError('write-rows', new Error('commit has an invalid revision'), sessionId)
  }
  const activeRows = rows.threads.filter((thread) => thread.seq === -1)
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

function assertMessageRow(operation: SessionRowStoreOperation, sessionId: string, row: MessageRow): void {
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
    store.delete(cursor.primaryKey)
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

  initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.openDatabase().catch((error) => {
        this.initPromise = null
        throw error
      })
    }
    return this.initPromise
  }

  private openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(SESSION_ROW_DB_NAME, DB_VERSION)
      watchDbOpenBlocked(SESSION_ROW_DB_NAME, request)

      request.onerror = () => reject(toDbOpenError(SESSION_ROW_DB_NAME, request.error))

      request.onsuccess = () => {
        const db = request.result
        this.db = db
        reportDbOpenSucceeded(SESSION_ROW_DB_NAME)
        watchDbVersionChange(SESSION_ROW_DB_NAME, db, () => {
          if (this.db === db) {
            this.db = null
            this.initPromise = null
          }
        })
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(SESSION_ROW_THREAD_STORE)) {
          const threads = db.createObjectStore(SESSION_ROW_THREAD_STORE, { keyPath: ['sessionId', 'threadId'] })
          threads.createIndex(SESSION_INDEX, 'sessionId', { unique: false })
        }
        if (!db.objectStoreNames.contains(SESSION_ROW_MESSAGE_STORE)) {
          const messages = db.createObjectStore(SESSION_ROW_MESSAGE_STORE, { keyPath: ['sessionId', 'messageId'] })
          messages.createIndex(SESSION_INDEX, 'sessionId', { unique: false })
          messages.createIndex(STATUS_INDEX, ['status', 'sessionId', 'threadId', 'messageId'], { unique: false })
        }
      }
    })
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
  ): Promise<void> {
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

      tx.oncomplete = () => resolve()
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

  async readSnapshot(sessionId: string): Promise<SessionRowSnapshot | null> {
    const db = await this.ensureDatabase('read-rows', sessionId)
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ROW_STORES, 'readonly')
      const threadRequest = tx.objectStore(SESSION_ROW_THREAD_STORE).index(SESSION_INDEX).getAll(sessionId)
      const messageRequest = tx.objectStore(SESSION_ROW_MESSAGE_STORE).index(SESSION_INDEX).getAll(sessionId)

      tx.oncomplete = () => {
        const storedThreads = threadRequest.result as Array<PersistedThreadRow | RevisionHeadRow>
        const head = storedThreads.find(isRevisionHeadRow)
        const persisted = storedThreads.filter((row): row is PersistedThreadRow => !isRevisionHeadRow(row))
        const messages = messageRequest.result as MessageRow[]
        if (persisted.length === 0 && messages.length === 0) {
          resolve(null)
          return
        }
        try {
          const commit = readStoredCommit(sessionId, persisted, head)
          resolve({ rows: { sessionId, threads: persisted.map(plainThreadRow), messages }, ...commit })
        } catch (error) {
          reject(new SessionRowStoreError('read-rows', error, sessionId))
        }
      }
      tx.onerror = () => reject(new SessionRowStoreError('read-rows', tx.error, sessionId))
      tx.onabort = () => reject(new SessionRowStoreError('read-rows', tx.error, sessionId))
    })
  }

  async readMessageWindow(request: SessionMessageWindowRequest): Promise<SessionMessageWindow | null> {
    const { sessionId } = request
    try {
      validateMessageWindowRequest(request)
    } catch (error) {
      throw new SessionRowStoreError('read-message-window', error, sessionId)
    }
    const db = await this.ensureDatabase('read-message-window', sessionId)
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ROW_STORES, 'readonly')
      const threads = tx.objectStore(SESSION_ROW_THREAD_STORE)
      const messages = tx.objectStore(SESSION_ROW_MESSAGE_STORE)
      let result: SessionMessageWindow | null = null
      let failure: unknown
      const fail = (error: unknown) => {
        failure = error
        tx.abort()
      }
      const readThread = (commit: SessionRowCommit) => {
        const threadId = request.threadId ?? request.cursor?.threadId ?? commit.record.activeThreadId
        const threadRequest = threads.get([sessionId, threadId])
        threadRequest.onsuccess = () => {
          try {
            const thread = threadRequest.result as PersistedThreadRow | undefined
            if (!thread) throw new Error('Message window thread is missing')
            const traversal = new SessionMessageWindowTraversal(request, commit, plainThreadRow(thread))
            const selected: MessageRow[] = []
            const readNext = () => {
              if (traversal.nextMessageId === null || traversal.remaining === 0) {
                result = traversal.finish(selected)
                return
              }
              const rowRequest = messages.get([sessionId, traversal.nextMessageId])
              rowRequest.onsuccess = () => {
                try {
                  const row = rowRequest.result as MessageRow | undefined
                  if (traversal.accept(row) && row) selected.push(row)
                  readNext()
                } catch (error) {
                  fail(error)
                }
              }
            }
            readNext()
          } catch (error) {
            fail(error)
          }
        }
      }
      const headRequest = threads.get([sessionId, REVISION_HEAD_THREAD_ID])
      headRequest.onsuccess = () => {
        try {
          const head = headRequest.result as RevisionHeadRow | undefined
          assertMessageWindowRevision(request, head?.commitRevision ?? null)
          if (head?.sessionRecord) {
            const activeRequest = threads.get([sessionId, head.sessionRecord.activeThreadId])
            activeRequest.onsuccess = () => {
              try {
                const active = activeRequest.result as PersistedThreadRow | undefined
                readThread(readStoredCommit(sessionId, active ? [active] : [], head))
              } catch (error) {
                fail(error)
              }
            }
          } else {
            const fallback = threads.index(SESSION_INDEX).getAll(sessionId)
            fallback.onsuccess = () => {
              try {
                const stored = fallback.result as Array<PersistedThreadRow | RevisionHeadRow>
                const persisted = stored.filter((row): row is PersistedThreadRow => !isRevisionHeadRow(row))
                if (persisted.length > 0) readThread(readStoredCommit(sessionId, persisted, head))
              } catch (error) {
                fail(error)
              }
            }
          }
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
            : new SessionRowStoreError('read-message-window', error, sessionId)
        )
      }
      tx.onerror = rejectRead
      tx.onabort = rejectRead
    })
  }

  async readMessages(request: SessionMessagesRequest): Promise<SessionMessagesSnapshot | null> {
    try {
      validateSessionMessagesRequest(request)
    } catch (error) {
      throw new SessionRowStoreError('read-messages', error, request.sessionId)
    }
    return this.readSelectedSnapshot('read-messages', request, (tx, commit, _threads, finish, fail) => {
      const ids = [...new Set(request.messageIds)]
      this.readSelectedRows(tx, request.sessionId, ids, (messages) => finish({ ...commit, messages }), fail)
    })
  }

  async readContext(request: SessionContextRequest): Promise<SessionContextRows | null> {
    try {
      validateSessionContextRequest(request)
    } catch (error) {
      throw new SessionRowStoreError('read-context', error, request.sessionId)
    }
    return this.readSelectedSnapshot('read-context', request, (tx, commit, threads, finish, fail) => {
      const thread = threads.find((row) => row.threadId === (request.threadId ?? commit.record.activeThreadId))
      const targetId = request.targetMessageId ?? thread?.activeLeafMessageId
      this.readSelectedRows(
        tx,
        request.sessionId,
        targetId ? [targetId] : [],
        (targets) => {
          const plan = planSessionContextRead(request, commit, threads, targets[0])
          const readPlan = (current: SessionContextReadPlan) => {
            const traversal = new SessionContextPathTraversal(request.sessionId, current)
            const path: MessageRow[] = []
            const readNext = () => {
              if (traversal.nextMessageId === null) {
                path.reverse()
                const extras = current.checkpoint
                  ? [current.checkpoint.point.summaryMessageId, current.checkpoint.systemMessageId].filter(
                      (id): id is string => Boolean(id) && !path.some((row) => row.messageId === id)
                    )
                  : []
                this.readSelectedRows(
                  tx,
                  request.sessionId,
                  extras,
                  (extra) => {
                    const result = finishSessionContextRead(request, commit, current, path, extra)
                    if (result) finish(result)
                    else if (current.checkpoint) readPlan({ ...current, checkpoint: undefined })
                    else throw new Error('Context fallback is incomplete')
                  },
                  fail
                )
                return
              }
              this.readSelectedRows(
                tx,
                request.sessionId,
                [traversal.nextMessageId],
                (rows) => {
                  traversal.accept(rows[0])
                  path.push(rows[0])
                  readNext()
                },
                fail
              )
            }
            readNext()
          }
          readPlan(plan)
        },
        fail
      )
    })
  }

  private async readSelectedSnapshot<Result>(
    operation: SessionRowStoreOperation,
    request: { sessionId: string; expectedRevision?: number },
    select: (
      tx: IDBTransaction,
      commit: SessionRowCommit,
      threads: ThreadRow[],
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
      const read = tx.objectStore(SESSION_ROW_THREAD_STORE).index(SESSION_INDEX).getAll(request.sessionId)
      read.onsuccess = () => {
        try {
          const stored = read.result as Array<PersistedThreadRow | RevisionHeadRow>
          const head = stored.find(isRevisionHeadRow)
          const threads = stored.filter((row): row is PersistedThreadRow => !isRevisionHeadRow(row))
          assertSessionReadRevision(
            request,
            head?.commitRevision ?? threads.find((row) => row.seq === -1)?.commitRevision ?? null
          )
          if (threads.length === 0) return
          const commit = readStoredCommit(request.sessionId, threads, head)
          select(
            tx,
            commit,
            threads.map(plainThreadRow),
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
          const row = read.result as MessageRow | undefined
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

    await this.runWrite('write-rows', sessionId, ROW_STORES, (tx, fail) => {
      const threadStore = tx.objectStore(SESSION_ROW_THREAD_STORE)
      const messageStore = tx.objectStore(SESSION_ROW_MESSAGE_STORE)
      const replace = () => {
        clearSessionRows(threadStore, sessionId, () => {
          clearSessionRows(messageStore, sessionId, () => {
            try {
              for (const thread of rows.threads) {
                threadStore.put(thread)
              }
              for (const message of rows.messages) {
                messageStore.put(message)
              }
              threadStore.put(revisionHead(sessionId, { record, revision }))
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

  async applyDiff(diff: SessionRowsDiff, commit: SessionRowCommit, expectedRevision?: number): Promise<void> {
    const sessionId = diff.sessionId
    assertSessionId('apply-diff', sessionId)
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

    await this.runWrite('apply-diff', sessionId, ROW_STORES, (tx, fail) => {
      const threadStore = tx.objectStore(SESSION_ROW_THREAD_STORE)
      const messageStore = tx.objectStore(SESSION_ROW_MESSAGE_STORE)
      const apply = () => {
        try {
          for (const thread of diff.threads.upsert) {
            threadStore.put(thread)
          }
          for (const message of diff.messages.upsert) {
            messageStore.put(message)
          }
          for (const threadId of diff.threads.delete) {
            threadStore.delete([sessionId, threadId])
          }
          for (const messageId of diff.messages.delete) {
            messageStore.delete([sessionId, messageId])
          }
          threadStore.put(revisionHead(sessionId, commit))
        } catch (error) {
          fail(error)
        }
      }

      if (expectedRevision === undefined) {
        apply()
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
        apply()
      }
    })
  }

  async deleteRows(sessionId: string, expectedRevision?: number | null): Promise<void> {
    assertSessionId('delete-rows', sessionId)
    await this.runWrite('delete-rows', sessionId, ROW_STORES, (tx, fail) => {
      const threadStore = tx.objectStore(SESSION_ROW_THREAD_STORE)
      const remove = (revision: number | null) => {
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
        resolve(storedRevision(request.result as PersistedThreadRow | RevisionHeadRow | undefined))
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
      const tx = db.transaction(SESSION_ROW_MESSAGE_STORE, 'readonly')
      const refs: GeneratingMessageRef[] = []
      const request = tx
        .objectStore(SESSION_ROW_MESSAGE_STORE)
        .index(STATUS_INDEX)
        .openKeyCursor(statusKeyRange(status))

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
