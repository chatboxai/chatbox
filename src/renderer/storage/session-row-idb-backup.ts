import { BackupMessageValidator } from '@chatbox/core/backup'
import {
  putTranscriptThread,
  rebuildRestoredSelectedDepths,
  putTranscriptMessage,
  TRANSCRIPT_THREADS,
  TRANSCRIPT_MESSAGES,
} from './session-row-idb-transcript'
import { v4 as uuid } from 'uuid'
import {
  BackupRowProjectionBuilder,
  backupPageLimits,
  fitsInlineBackupJson,
  jsonUtf8Chunks,
  backupPayloadBlocks,
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
  MESSAGE_ORDER_INDEX,
  SESSION_ROW_PAYLOAD_STORE as PAYLOADS,
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

import {
  readBackupPayload,
  messageMetadata,
  payloadRange,
  type StoredMessageRow,
  type PayloadRef,
  type PayloadChunk,
} from './session-row-idb-payload'
import { prepareIndexedDBBackupMessage } from './session-row-idb-backup-source'

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
  signal?: AbortSignal,
  threadId?: string
): AsyncGenerator<BackupRow> {
  const limits = backupPageLimits(requested)
  throwIfAborted(signal)
  const messageRange = IDBKeyRange.bound(
    threadId ? [sessionId, threadId] : [sessionId],
    threadId ? [sessionId, threadId, []] : [sessionId, []]
  )
  const snapshot = await transaction<BackupIndex>(db, 'readonly', ({ tx, success, finish }) => {
    const refs: RowRef[] = []
    const active: PersistedThreadRow[] = []
    let head: RevisionHeadRow | undefined
    let completed = 0
    let indexBytes = 0
    let expectedMessages = 0
    let messages = 0
    const add = (ref: RowRef) => {
      indexBytes += byteSize(ref)
      if (indexBytes > INDEX_BUDGET) throw new Error('Backup structural index exceeds budget')
      refs.push(ref)
    }
    const done = () => {
      if (++completed !== 3) return
      if (messages !== expectedMessages) throw new Error('Backup message ordering index is incomplete')
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
    success(
      threadId
        ? tx.objectStore(TRANSCRIPT_MESSAGES).index(MESSAGE_ORDER_INDEX).count(messageRange)
        : tx.objectStore(MESSAGES).index(SESSION_INDEX).count(sessionId),
      (count) => {
        expectedMessages = count
        done()
      }
    )
    if (threadId) {
      success(
        tx.objectStore(THREADS).get([sessionId, REVISION_HEAD_THREAD_ID]),
        (value: RevisionHeadRow | undefined) => {
          if (!value?.sessionRecord) throw new Error('Thread backup requires a row commit')
          head = value
          success(
            tx.objectStore(THREADS).get([sessionId, value.sessionRecord.activeThreadId]),
            (value: PersistedThreadRow | undefined) => {
              if (!value) throw new Error('Active thread is missing')
              active.push(value)
              success(tx.objectStore(THREADS).get([sessionId, threadId]), (value: PersistedThreadRow | undefined) => {
                if (!value) throw new Error('Backup thread is missing')
                const bytes = byteSize({ kind: 'thread', thread: plainThreadRow(value) })
                if (bytes > limits.maxRecordBytes) throw new Error('Backup record requires payload blocks')
                add({ kind: 'thread', id: value.threadId, threadId: value.threadId, order: value.seq, bytes })
                done()
              })
            }
          )
        }
      )
    } else
      success(tx.objectStore(THREADS).index(SESSION_INDEX).openCursor(sessionId), (cursor) => {
        throwIfAborted(signal)
        if (!cursor) {
          done()
          return
        }
        const value = cursor.value as PersistedThreadRow | RevisionHeadRow
        if (isRevisionHeadRow(value)) head = value
        else {
          if (value.seq === -1) {
            if (active.length) throw new Error('Backup session has multiple active threads')
            active.push(value)
          }
          const bytes = byteSize({ kind: 'thread', thread: plainThreadRow(value) })
          if (bytes > limits.maxRecordBytes) throw new Error('Backup record requires payload blocks')
          add({ kind: 'thread', id: value.threadId, threadId: value.threadId, order: value.seq, bytes })
        }
        cursor.continue()
      })
    success(tx.objectStore(TRANSCRIPT_MESSAGES).index(MESSAGE_ORDER_INDEX).openKeyCursor(messageRange), (cursor) => {
      throwIfAborted(signal)
      if (!cursor) {
        done()
        return
      }
      const key = cursor.key as [string, string, number, string]
      if (typeof key[1] !== 'string' || !Number.isSafeInteger(key[2]) || typeof key[3] !== 'string')
        throw new Error('Invalid backup ordering key')
      add({ kind: 'message', id: key[3], threadId: key[1], order: key[2], bytes: 0 })
      messages++
      cursor.continue()
    })
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
          if (ref.kind === 'thread') {
            const row: BackupRow = { kind: 'thread', thread: plainThreadRow(value) }
            if (byteSize(row) !== ref.bytes) throw new Error('Backup row changed during traversal')
            rows.push(row)
            done()
          } else {
            success(tx.objectStore(TRANSCRIPT_MESSAGES).get([sessionId, ref.id]), (projection) => {
              if (!projection) throw new Error('Backup metadata is missing')
              const stored: StoredMessageRow = {
                ...messageMetadata(value),
                ...messageMetadata(projection),
                message: value.message,
                payload: value.payload,
              }
              rows.push({ kind: 'message', message: stored as MessageRow })
              done()
            })
          }
        })
      }
    })
  yield snapshot.header
  for (const ref of snapshot.refs) {
    const [row] = await readPage([ref])
    if (row.kind !== 'message') {
      yield row
      continue
    }
    const stored = row.message as StoredMessageRow
    const { message, payload } = stored
    const chunks = async function* () {
      await readPage([])
      if (payload) yield* readBackupPayload(db, sessionId, payload, signal)
      else {
        for (const data of jsonUtf8Chunks(message)) {
          throwIfAborted(signal)
          yield data
        }
      }
      await readPage([])
    }
    yield* prepareIndexedDBBackupMessage(stored, limits.maxRecordBytes, chunks, signal)
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
  value: PersistedThreadRow | RevisionHeadRow | StoredMessageRow
}

function candidateRange(id: string) {
  return IDBKeyRange.bound([id], [id, []])
}
function stage(id: string, index: number, store: StagedRow['store'], value: StagedRow['value']): StagedRow {
  return { sessionId: [id, index], threadId: REVISION_HEAD_THREAD_ID, seq: -2, store, value }
}

/** Publish and rollback copy via cursors inside one transaction. Only a single
 * row is materialized at a time; readers see the complete old or new snapshot. */
export async function beginIndexedDBBackupRestore(
  db: IDBDatabase,
  sessionId: string,
  expectedRevision?: number | null
): Promise<BackupSessionCandidate> {
  if (!sessionId) throw new Error('Backup session id is missing')
  const expected = await transaction<number | null>(db, 'readonly', ({ tx, success, finish }) => {
    success(tx.objectStore(THREADS).get([sessionId, REVISION_HEAD_THREAD_ID]), (value) => finish(storedRevision(value)))
  })
  if (expectedRevision !== undefined && expectedRevision !== expected)
    throw new SessionRowConflictError(sessionId, expectedRevision, expected)
  const revision = (expected ?? 0) + 1
  if (!Number.isSafeInteger(revision)) throw new Error('Session revision exhausted')
  const projection = new BackupRowProjectionBuilder()
  let converted: ReturnType<BackupRowProjectionBuilder['finish']> | undefined
  let convertedMessages: Map<string, ReturnType<BackupRowProjectionBuilder['finish']>['messages'][number]> | undefined
  let convertedThreads: Map<string, ThreadRow> | undefined
  const candidateId = uuid()
  const previousId = uuid()
  let phase: 'collecting' | 'published' | 'rolled-back' | 'disposed' = 'collecting'
  let count = 0
  let activeThreadId: string | undefined
  let activeThreadCount = 0
  let pendingPayload: PayloadRef | undefined
  let payloadValidator: BackupMessageValidator | undefined
  let prepared = false
  const candidatePayloads = new Set<string>()
  const previousPayloads = new Set<string>()
  const originalPayloads = new Set<string>()
  const appendChunk = async (ref: PayloadRef, data: Uint8Array) => {
    if (!data.length || data.length > 128 * 1024) throw new Error('Backup payload block exceeds budget')
    await transaction<void>(db, 'readwrite', ({ tx, finish }) => {
      tx.objectStore(PAYLOADS).add({ payloadId: ref.id, index: ref.count, sessionId, data } satisfies PayloadChunk)
      finish(undefined)
    })
    ref.count++
    ref.size += data.length
  }
  const preparePrevious = async (signal?: AbortSignal) => {
    if (prepared) return
    let index = 0
    for (const store of [THREADS, MESSAGES] as const) {
      const keys = await transaction<IDBValidKey[]>(db, 'readonly', ({ tx, success, finish }) => {
        const keys: IDBValidKey[] = []
        let bytes = 0
        success(tx.objectStore(store).index(SESSION_INDEX).openKeyCursor(sessionId), (cursor) => {
          if (!cursor) {
            finish(keys)
            return
          }
          bytes += byteSize(cursor.primaryKey)
          if (bytes > INDEX_BUDGET) throw new Error('Backup rollback index exceeds budget')
          keys.push(cursor.primaryKey)
          cursor.continue()
        })
      })
      for (const key of keys) {
        throwIfAborted(signal)
        let value = await transaction<StagedRow['value']>(db, 'readonly', ({ tx, success, finish }) => {
          success(tx.objectStore(store).get(key), (value) => {
            if (store !== MESSAGES || !value) {
              finish(value)
              return
            }
            success(tx.objectStore(TRANSCRIPT_MESSAGES).get(key), (projection) => {
              if (!projection) throw new Error('Rollback metadata is missing')
              finish({ ...messageMetadata(value), ...messageMetadata(projection) })
            })
          })
        })
        if (!value) throw new Error('Backup source changed during rollback preparation')
        if (store === MESSAGES) {
          const row = value as StoredMessageRow
          if (row.payload) originalPayloads.add(row.payload.id)
          else if (!fitsInlineBackupJson(row, 128 * 1024)) {
            const payload: PayloadRef = { id: uuid(), size: 0, count: 0 }
            previousPayloads.add(payload.id)
            const chunks = async function* () {
              yield* jsonUtf8Chunks(row.message)
            }
            for await (const chunk of backupPayloadBlocks(chunks())) {
              throwIfAborted(signal)
              await appendChunk(payload, chunk)
            }
            const { message, ...metadata } = row
            value = { ...metadata, payload }
          }
        }
        await transaction<void>(db, 'readwrite', ({ tx, finish }) => {
          tx.objectStore(THREADS).add(stage(previousId, index++, store, value))
          finish(undefined)
        })
      }
    }
    prepared = true
  }

  const replace = (rollback: boolean) =>
    transaction<void>(db, 'readwrite', (context) => {
      const { tx, success, finish } = context
      const threads = tx.objectStore(THREADS)
      tx.objectStore(TRANSCRIPT_THREADS).delete(IDBKeyRange.bound([sessionId], [sessionId, []]))
      tx.objectStore(TRANSCRIPT_MESSAGES).delete(IDBKeyRange.bound([sessionId], [sessionId, []]))
      const copyCandidate = () => {
        let copied = 0
        const request = threads.index(SESSION_INDEX).openCursor(candidateRange(rollback ? previousId : candidateId))
        success(request, (cursor) => {
          if (!cursor) {
            if (!rollback && copied !== count) throw new Error('Backup candidate is incomplete')
            rebuildRestoredSelectedDepths(tx, sessionId)
              .then(() => finish(undefined))
              .catch(context.fail)
            return
          }
          const entry = cursor.value as StagedRow
          if (!rollback) {
            if (!converted) throw new Error('Backup candidate projections are missing')
            if (entry.store === MESSAGES) {
              const stored = entry.value as StoredMessageRow
              const metadata = convertedMessages?.get(stored.messageId)
              if (!metadata) throw new Error('Backup message projection is missing')
              entry.value = { ...stored, ...metadata }
            } else if (isRevisionHeadRow(entry.value as PersistedThreadRow | RevisionHeadRow))
              entry.value = revisionHead(sessionId, { record: converted.session, revision })
            else {
              const thread = convertedThreads?.get((entry.value as ThreadRow).threadId)
              if (!thread) throw new Error('Backup thread projection is missing')
              entry.value = {
                ...thread,
                ...(thread.seq === -1 ? { sessionRecord: converted.session, commitRevision: revision } : {}),
              }
            }
          }
          tx.objectStore(entry.store).put(entry.value)
          if (entry.store === MESSAGES) putTranscriptMessage(tx, entry.value as StoredMessageRow)
          else if (!isRevisionHeadRow(entry.value as PersistedThreadRow | RevisionHeadRow))
            putTranscriptThread(tx, entry.value as PersistedThreadRow)
          copied++
          cursor.continue()
        })
      }
      const preserveAndClear = (storeIndex: number) => {
        if (storeIndex === 2) {
          copyCandidate()
          return
        }
        const storeName = ([THREADS, MESSAGES] as const)[storeIndex]
        const store = tx.objectStore(storeName)
        const request = store.index(SESSION_INDEX).openKeyCursor(IDBKeyRange.only(sessionId))
        success(request, (cursor) => {
          if (!cursor) {
            preserveAndClear(storeIndex + 1)
            return
          }
          store.delete(cursor.primaryKey)
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
    async appendPayload(data) {
      if (phase !== 'collecting' || !count) throw new Error('Backup candidate is closed')
      if (!pendingPayload) {
        pendingPayload = { id: uuid(), size: 0, count: 0 }
        payloadValidator = new BackupMessageValidator()
        candidatePayloads.add(pendingPayload.id)
      }
      payloadValidator!.write(data)
      await appendChunk(pendingPayload, data)
    },
    async append(row) {
      if (phase !== 'collecting') throw new Error('Backup candidate is closed')
      row = projection.append(row, row.kind === 'message' && row.payload ? payloadValidator?.finishFacts() : undefined)
      if (byteSize(row) > 128 * 1024) throw new Error('Backup record requires payload blocks')
      let value: StagedRow['value']
      let active = false
      if (row.kind === 'header') {
        if (count || row.record.id !== sessionId) throw new Error('Invalid backup header')
        value = revisionHead(sessionId, { record: row.record, revision })
      } else {
        if (!count) throw new Error('Backup header must precede rows')
        value = row.kind === 'thread' ? row.thread : row.message
        if (row.kind === 'message' && row.payload) {
          if (!pendingPayload || row.payload.size !== pendingPayload.size)
            throw new Error('Backup payload is incomplete')
          const { message, ...metadata } = row.message
          value = { ...metadata, payload: pendingPayload }
        } else if (pendingPayload) throw new Error('Backup payload has no owning message')
        if (value.sessionId !== sessionId || !value.threadId || value.threadId === REVISION_HEAD_THREAD_ID)
          throw new Error('Invalid backup row identity')
        if (row.kind === 'thread' && row.thread.seq === -1) {
          if (row.thread.threadId !== activeThreadId || activeThreadCount)
            throw new Error('Invalid backup active thread')
          active = true
        }
      }
      // Keep the atomic publication transaction small: bodies live in independently written payload blocks.
      if (row.kind === 'message' && !row.payload && !fitsInlineBackupJson(row.message, 128 * 1024)) {
        const payload: PayloadRef = { id: uuid(), size: 0, count: 0 }
        candidatePayloads.add(payload.id)
        const chunks = async function* () {
          yield* jsonUtf8Chunks(row.message.message)
        }
        for await (const chunk of backupPayloadBlocks(chunks())) await appendChunk(payload, chunk)
        const { message, ...metadata } = row.message
        value = { ...metadata, payload }
      }
      await transaction<void>(db, 'readwrite', ({ tx, finish }) => {
        tx.objectStore(THREADS).add(stage(candidateId, count, row.kind === 'message' ? MESSAGES : THREADS, value))
        finish(undefined)
      })
      count++
      if (row.kind === 'message' && row.payload) {
        pendingPayload = undefined
        payloadValidator = undefined
      }
      if (row.kind === 'header') activeThreadId = row.record.activeThreadId
      if (active) activeThreadCount++
    },
    async publish(signal) {
      if (phase !== 'collecting' || activeThreadCount !== 1 || pendingPayload)
        throw new Error('Backup candidate is not publishable')
      converted = projection.finish()
      convertedMessages = new Map(converted.messages.map((row) => [row.messageId, row]))
      convertedThreads = new Map(converted.threads.map((row) => [row.threadId, row]))
      await preparePrevious(signal)
      throwIfAborted(signal)
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
        const remove = [
          ...(phase === 'published' ? originalPayloads : candidatePayloads),
          ...(phase === 'rolled-back' ? [] : previousPayloads),
        ]
        for (const id of remove) tx.objectStore(PAYLOADS).delete(payloadRange(id))
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
