import { v4 as uuid } from 'uuid'
import {
  backupPageLimits,
  compareBackupIds,
  throwIfAborted,
  type BackupPageLimits,
  type BackupRow,
  type BackupSessionCandidate,
} from '@chatbox/core/backup'
import { SessionRowConflictError } from '@chatbox/core/ports'
import type { MessageRow, ThreadRow } from '@chatbox/core/session/session-tree'
import {
  SESSION_ROW_THREAD_STORE as THREADS,
  SESSION_ROW_MESSAGE_STORE as MESSAGES,
  SESSION_INDEX,
  REVISION_HEAD_THREAD_ID,
  ROW_STORES,
  isRevisionHeadRow,
  plainThreadRow,
  readStoredCommit,
  revisionHead,
  storedRevision,
  type PersistedThreadRow,
  type RevisionHeadRow,
} from './session-row-idb-records'

const encoder = new TextEncoder()
const INDEX_BUDGET = 16 * 1024 * 1024
const byteSize = (value: unknown) => encoder.encode(JSON.stringify(value)).length

interface TransactionContext<Result> {
  tx: IDBTransaction
  finish(value: Result): void
  fail(error: unknown): void
  success<Value>(request: IDBRequest<Value>, next: (value: Value) => void): void
}

function transaction<Result>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (context: TransactionContext<Result>) => void
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ROW_STORES, mode)
    let result: Result
    let failure: unknown
    let finished = false
    const fail = (error: unknown) => {
      if (failure !== undefined) return
      failure = error
      tx.abort()
    }
    tx.oncomplete = () => (finished ? resolve(result) : reject(new Error('Backup transaction ended before completion')))
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('Backup transaction failed'))
    try {
      work({
        tx,
        fail,
        finish: (value) => {
          result = value
          finished = true
        },
        success: (request, next) => {
          request.onsuccess = () => {
            try {
              next(request.result)
            } catch (error) {
              fail(error)
            }
          }
        },
      })
    } catch (error) {
      fail(error)
    }
  })
}

interface RowRef {
  kind: 'thread' | 'message'
  id: string
  threadId: string
  order: number
  bytes: number
}

interface BackupIndex {
  refs: RowRef[]
  header: BackupRow
  revision: number | null
  activeRevision: number | undefined
  activeThreadId: string
}

/** bySession is a grouping index, not chronological order. Retain only a bounded
 * structural index and fetch payload pages in the protocol's UTF-8 ordering. */
export async function* iterateIndexedDBBackupRows(
  db: IDBDatabase,
  sessionId: string,
  requested: BackupPageLimits,
  signal?: AbortSignal
): AsyncGenerator<BackupRow> {
  const limits = backupPageLimits(requested)
  throwIfAborted(signal)
  const snapshot = await transaction<BackupIndex>(db, 'readonly', ({ tx, success, finish }) => {
    const refs: RowRef[] = []
    const active: PersistedThreadRow[] = []
    let head: RevisionHeadRow | undefined
    let completed = 0
    let indexBytes = 0
    const done = () => {
      if (++completed !== 2) return
      const commit = readStoredCommit(sessionId, active, head)
      const header: BackupRow = { kind: 'header', record: commit.record }
      if (byteSize(header) > limits.maxRecordBytes) throw new Error('Backup header requires payload blocks')
      finish({
        refs,
        header,
        revision: storedRevision(head),
        activeRevision: active[0].commitRevision,
        activeThreadId: commit.record.activeThreadId,
      })
    }
    for (const kind of ['thread', 'message'] as const) {
      const request = tx
        .objectStore(kind === 'thread' ? THREADS : MESSAGES)
        .index(SESSION_INDEX)
        .openCursor(IDBKeyRange.only(sessionId))
      success(request, function next(cursor) {
        throwIfAborted(signal)
        if (!cursor) {
          done()
          return
        }
        if (kind === 'thread') {
          const value = cursor.value as PersistedThreadRow | RevisionHeadRow
          if (isRevisionHeadRow(value)) {
            head = value
            cursor.continue()
            return
          }
          if (value.seq === -1) {
            if (active.length) throw new Error('Backup session has multiple active threads')
            active.push(value)
          }
        }
        const value = cursor.value as ThreadRow | MessageRow
        const row: BackupRow =
          kind === 'thread'
            ? { kind, thread: plainThreadRow(value as PersistedThreadRow) }
            : { kind, message: value as MessageRow }
        const bytes = byteSize(row)
        if (bytes > limits.maxRecordBytes) throw new Error('Backup record requires payload blocks')
        const ref: RowRef = {
          kind,
          id: kind === 'thread' ? (value as ThreadRow).threadId : (value as MessageRow).messageId,
          threadId: value.threadId,
          order: value.seq,
          bytes,
        }
        indexBytes += byteSize(ref)
        if (indexBytes > INDEX_BUDGET) throw new Error('Backup structural index exceeds budget')
        refs.push(ref)
        cursor.continue()
      })
    }
  })
  snapshot.refs.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'thread' ? -1 : 1
    if (left.kind === 'message') {
      const threadOrder = compareBackupIds(left.threadId, right.threadId)
      if (threadOrder) return threadOrder
    }
    return left.order - right.order || compareBackupIds(left.id, right.id)
  })
  const readPage = (refs: RowRef[]) =>
    transaction<BackupRow[]>(db, 'readonly', ({ tx, success, finish }) => {
      const threads = tx.objectStore(THREADS)
      let head: PersistedThreadRow | RevisionHeadRow | undefined
      let active: PersistedThreadRow | undefined
      const rows: BackupRow[] = []
      let pending = refs.length + 2
      const done = () => {
        if (--pending) return
        const revision = storedRevision(head)
        if (revision !== snapshot.revision || (revision === null && active?.commitRevision !== snapshot.activeRevision))
          throw new SessionRowConflictError(sessionId, snapshot.revision, revision)
        throwIfAborted(signal)
        finish(rows)
      }
      success(threads.get([sessionId, REVISION_HEAD_THREAD_ID]), (value) => {
        head = value
        done()
      })
      success(threads.get([sessionId, snapshot.activeThreadId]), (value) => {
        active = value
        done()
      })
      for (const ref of refs) {
        success(tx.objectStore(ref.kind === 'thread' ? THREADS : MESSAGES).get([sessionId, ref.id]), (value) => {
          if (!value) throw new Error('Backup row disappeared during traversal')
          const row: BackupRow =
            ref.kind === 'thread'
              ? { kind: 'thread', thread: plainThreadRow(value) }
              : { kind: 'message', message: value }
          if (byteSize(row) !== ref.bytes) throw new Error('Backup row changed during traversal')
          rows.push(row)
          done()
        })
      }
    })
  yield snapshot.header
  let offset = 0
  while (offset < snapshot.refs.length) {
    throwIfAborted(signal)
    const page: RowRef[] = []
    let bytes = 0
    while (offset < snapshot.refs.length && page.length < limits.maxPageRows) {
      const next = snapshot.refs[offset]
      if (page.length && bytes + next.bytes > limits.maxPageBytes) break
      page.push(next)
      bytes += next.bytes
      offset++
    }
    for (const row of await readPage(page)) yield row
  }
  await readPage([])
}

interface StagedRow {
  /** Array keys cannot collide with the string session IDs in published rows. */
  sessionId: [string, number]
  /** Historical session inventories already exclude this reserved key. */
  threadId: typeof REVISION_HEAD_THREAD_ID
  seq: -2
  store: typeof THREADS | typeof MESSAGES
  value: PersistedThreadRow | RevisionHeadRow | MessageRow
}

function candidateRange(id: string) {
  return IDBKeyRange.bound([id], [id, []])
}
function stage(id: string, index: number, store: StagedRow['store'], value: StagedRow['value']): StagedRow {
  return { sessionId: [id, index], threadId: REVISION_HEAD_THREAD_ID, seq: -2, store, value }
}

/** Publish and rollback copy via cursors inside one transaction. Only a single
 * row is materialized at a time; readers see the complete old or new snapshot. */
export async function beginIndexedDBBackupRestore(db: IDBDatabase, sessionId: string): Promise<BackupSessionCandidate> {
  if (!sessionId) throw new Error('Backup session id is missing')
  const expected = await transaction<number | null>(db, 'readonly', ({ tx, success, finish }) => {
    success(tx.objectStore(THREADS).get([sessionId, REVISION_HEAD_THREAD_ID]), (value) => finish(storedRevision(value)))
  })
  const revision = (expected ?? 0) + 1
  if (!Number.isSafeInteger(revision)) throw new Error('Session revision exhausted')
  const candidateId = uuid()
  const previousId = uuid()
  let phase: 'collecting' | 'published' | 'rolled-back' | 'disposed' = 'collecting'
  let count = 0
  let activeThreadId: string | undefined
  let activeThreadCount = 0

  const replace = (rollback: boolean) =>
    transaction<void>(db, 'readwrite', (context) => {
      const { tx, success, finish } = context
      const threads = tx.objectStore(THREADS)
      const copyCandidate = () => {
        let copied = 0
        const request = threads.index(SESSION_INDEX).openCursor(candidateRange(rollback ? previousId : candidateId))
        success(request, (cursor) => {
          if (!cursor) {
            if (!rollback && copied !== count) throw new Error('Backup candidate is incomplete')
            finish(undefined)
            return
          }
          const entry = cursor.value as StagedRow
          tx.objectStore(entry.store).put(entry.value)
          copied++
          cursor.continue()
        })
      }
      let oldIndex = 0
      const preserveAndClear = (storeIndex: number) => {
        if (storeIndex === ROW_STORES.length) {
          copyCandidate()
          return
        }
        const storeName = ROW_STORES[storeIndex]
        const store = tx.objectStore(storeName)
        const request = store.index(SESSION_INDEX).openCursor(IDBKeyRange.only(sessionId))
        success(request, (cursor) => {
          if (!cursor) {
            preserveAndClear(storeIndex + 1)
            return
          }
          if (!rollback) threads.put(stage(previousId, oldIndex++, storeName, cursor.value))
          cursor.delete()
          cursor.continue()
        })
      }
      success(threads.get([sessionId, REVISION_HEAD_THREAD_ID]), (value) => {
        const actual = storedRevision(value)
        const required = rollback ? revision : expected
        if (actual !== required) throw new SessionRowConflictError(sessionId, required, actual)
        preserveAndClear(0)
      })
    })
  return {
    async append(row) {
      if (phase !== 'collecting') throw new Error('Backup candidate is closed')
      if (byteSize(row) > 128 * 1024) throw new Error('Backup record requires payload blocks')
      let value: StagedRow['value']
      let active = false
      if (row.kind === 'header') {
        if (count || row.record.id !== sessionId) throw new Error('Invalid backup header')
        value = revisionHead(sessionId, { record: row.record, revision })
      } else {
        if (!count) throw new Error('Backup header must precede rows')
        value = row.kind === 'thread' ? row.thread : row.message
        if (value.sessionId !== sessionId || !value.threadId || value.threadId === REVISION_HEAD_THREAD_ID)
          throw new Error('Invalid backup row identity')
        if (row.kind === 'thread' && row.thread.seq === -1) {
          if (row.thread.threadId !== activeThreadId || activeThreadCount)
            throw new Error('Invalid backup active thread')
          active = true
        }
      }
      await transaction<void>(db, 'readwrite', ({ tx, finish }) => {
        tx.objectStore(THREADS).add(stage(candidateId, count, row.kind === 'message' ? MESSAGES : THREADS, value))
        finish(undefined)
      })
      count++
      if (row.kind === 'header') activeThreadId = row.record.activeThreadId
      if (active) activeThreadCount++
    },
    async publish() {
      if (phase !== 'collecting' || activeThreadCount !== 1) throw new Error('Backup candidate is not publishable')
      await replace(false)
      phase = 'published'
    },
    async rollback() {
      if (phase === 'disposed') throw new Error('Backup candidate is closed')
      if (phase !== 'published') return
      await replace(true)
      phase = 'rolled-back'
    },
    async dispose() {
      await transaction<void>(db, 'readwrite', ({ tx, success, finish }) => {
        let pending = 2
        const store = tx.objectStore(THREADS)
        for (const id of [candidateId, previousId]) {
          const request = store.index(SESSION_INDEX).openKeyCursor(candidateRange(id))
          success(request, (cursor) => {
            if (!cursor) {
              if (--pending === 0) finish(undefined)
              return
            }
            store.delete(cursor.primaryKey)
            cursor.continue()
          })
        }
      })
      phase = 'disposed'
    },
  }
}
