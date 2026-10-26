import {
  type SessionRowCommit,
  SessionRowConflictError,
  type SessionRowIterationRequest,
  type SessionRowWriter,
  type SessionStoredRow,
} from '@chatbox/core/ports'
import type { MessageRow, ThreadRow } from '@chatbox/core/session/session-tree'
import { deriveMessageFacts } from '@chatbox/core/session/session-tree'
import { throwIfAborted } from '@chatbox/core/utils/abort'
import { v4 as uuid } from 'uuid'
import { readStoredMessage } from './session-row-idb-messages'
import {
  isRevisionHeadRow,
  MESSAGE_ORDER_INDEX,
  SESSION_ROW_MESSAGE_STORE as MESSAGES,
  REVISION_HEAD_THREAD_ID,
  type RevisionHeadRow,
  ROW_STORES,
  ROW_TRANSFER_STAGE,
  revisionHead,
  SESSION_ROW_TOKEN_CACHE_STORE,
  storedRevision,
  SESSION_ROW_THREAD_STORE as THREADS,
} from './session-row-idb-records'
import {
  putTranscriptMessage,
  putTranscriptThread,
  TRANSCRIPT_MESSAGES,
  TRANSCRIPT_THREADS,
} from './session-row-idb-transcript'

interface StageThread {
  stageId: string
  kind: 'thread'
  id: string
  value: ThreadRow
}
interface StageMessage {
  stageId: string
  kind: 'message'
  id: string
  value: MessageRow
  selectedDepth?: number
}
type StageRow = StageThread | StageMessage
const sessionRange = (id: string) => IDBKeyRange.bound([id], [id, []])

export function requestValue<Value>(request: IDBRequest<Value>): Promise<Value> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function transaction<Value>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<Value>,
  stores: string[] = ROW_STORES
): Promise<Value> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let value: Value
    let finished = false
    let failure: unknown
    tx.oncomplete = () => (finished ? resolve(value) : reject(new Error('Row transfer transaction ended prematurely')))
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('Row transfer transaction failed'))
    work(tx).then(
      (result) => {
        value = result
        finished = true
      },
      (error: unknown) => {
        failure = error
        try {
          tx.abort()
        } catch {
          reject(error)
        }
      }
    )
  })
}

async function head(tx: IDBTransaction, sessionId: string): Promise<RevisionHeadRow | undefined> {
  return requestValue(tx.objectStore(THREADS).get([sessionId, REVISION_HEAD_THREAD_ID]))
}

function assertRevision(sessionId: string, expected: number | null, actual: number | null): void {
  if (expected !== actual) throw new SessionRowConflictError(sessionId, expected, actual)
}

export async function* iterateIndexedDBRows(
  db: IDBDatabase,
  request: SessionRowIterationRequest
): AsyncGenerator<SessionStoredRow> {
  const { sessionId, threadId, signal } = request
  if (!sessionId || threadId === '') throw new Error('Row iteration requires a valid identity')
  throwIfAborted(signal)
  const initial = await transaction(db, 'readonly', async (tx) => {
    const current = await head(tx, sessionId)
    if (
      current?.sessionRecord &&
      threadId !== undefined &&
      !(await requestValue(tx.objectStore(THREADS).get([sessionId, threadId])))
    )
      throw new Error('Row iteration thread is missing')
    return current
  })
  const expected = initial?.commitRevision ?? null
  if (request.expectedRevision !== undefined) assertRevision(sessionId, request.expectedRevision, expected)
  if (!initial?.sessionRecord) return

  for (const kind of ['thread', 'message'] as const) {
    let after: IDBValidKey | undefined
    while (true) {
      throwIfAborted(signal)
      const result = await transaction(db, 'readonly', async (tx) => {
        assertRevision(sessionId, expected, (await head(tx, sessionId))?.commitRevision ?? null)
        const isMessage = kind === 'message'
        const source = tx.objectStore(isMessage ? TRANSCRIPT_MESSAGES : THREADS)
        const prefix = isMessage && threadId !== undefined ? [sessionId, threadId] : [sessionId]
        const range = IDBKeyRange.bound(after ?? prefix, [...prefix, []], after !== undefined)
        const request = (isMessage ? source.index(MESSAGE_ORDER_INDEX) : source).openCursor(range)
        const rows: SessionStoredRow[] = []
        let key: IDBValidKey | undefined
        let bytes = 0
        for (let cursor = await requestValue(request); cursor; cursor = await requestValue(request)) {
          key = cursor.key
          if (!isMessage) {
            const row = cursor.value as ThreadRow | RevisionHeadRow
            if (!isRevisionHeadRow(row) && (threadId === undefined || row.threadId === threadId))
              rows.push({ kind: 'thread', thread: row })
          } else {
            const stored: MessageRow | undefined = await requestValue(tx.objectStore(MESSAGES).get(cursor.primaryKey))
            if (!stored) throw new Error('Message body is missing during row iteration')
            const message = await new Promise<MessageRow>((resolve, reject) =>
              readStoredMessage(tx, stored, resolve, reject)
            )
            rows.push({ kind: 'message', message })
            bytes += (cursor.value as { payloadBytes?: number }).payloadBytes ?? 512 * 1024
          }
          if (rows.length >= 128 || bytes >= 512 * 1024) break
          cursor.continue()
        }
        return key === undefined ? null : { key, rows }
      })
      if (!result) break
      after = result.key
      throwIfAborted(signal)
      for (const row of result.rows) {
        throwIfAborted(signal)
        yield row
      }
    }
  }
  await transaction(db, 'readonly', async (tx) => {
    throwIfAborted(signal)
    assertRevision(sessionId, expected, (await head(tx, sessionId))?.commitRevision ?? null)
  })
}

export function createRowTransferStore(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(ROW_TRANSFER_STAGE))
    db.createObjectStore(ROW_TRANSFER_STAGE, { keyPath: ['stageId', 'kind', 'id'] })
}

function visitStage(tx: IDBTransaction, id: string, visit: (row: StageRow) => void | Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = tx.objectStore(ROW_TRANSFER_STAGE).openCursor(sessionRange(id))
    request.onerror = () => reject(request.error)
    request.onsuccess = async () => {
      try {
        const cursor = request.result
        if (!cursor) return resolve()
        await visit(cursor.value as StageRow)
        cursor.continue()
      } catch (error) {
        reject(error)
      }
    }
  })
}

export async function stageIndexedDBRows(
  db: IDBDatabase,
  input: SessionRowCommit,
  expectedRevision: number | null
): Promise<SessionRowWriter> {
  const commit = structuredClone(input)
  const sessionId = commit.record.id
  if (
    !sessionId ||
    commit.record.rowFormatVersion !== 3 ||
    !commit.record.activeThreadId ||
    !Number.isSafeInteger(commit.revision) ||
    commit.revision !== (expectedRevision ?? 0) + 1
  )
    throw new Error('Row candidate commit is invalid')
  await transaction(db, 'readonly', async (tx) =>
    assertRevision(sessionId, expectedRevision, storedRevision(await head(tx, sessionId)))
  )
  const stageId = uuid()
  let phase: 'collecting' | 'published' | 'failed' | 'disposed' = 'collecting'
  let tail: Promise<void> = Promise.resolve()
  const enqueue = (work: () => Promise<void>) => {
    const result = tail.then(work)
    tail = result.catch(() => {})
    return result
  }
  const append = (inputRow: StageRow): Promise<void> => {
    let row: StageRow
    try {
      row = structuredClone(inputRow)
      if (row.kind === 'message') {
        row.value.facts = deriveMessageFacts(row.value.message)
        row.value.selected = false
      }
    } catch (error) {
      return enqueue(async () => {
        if (phase === 'collecting') phase = 'failed'
        throw error
      })
    }
    return enqueue(async () => {
      if (phase !== 'collecting') throw new Error('Row candidate is closed')
      try {
        if (row.value.sessionId !== sessionId || !row.value.threadId || row.value.threadId === REVISION_HEAD_THREAD_ID)
          throw new Error('Row candidate has an invalid identity')
        if (row.kind === 'message' && (!row.id || !row.value.message || row.value.message.id !== row.id))
          throw new Error('Row candidate message body is invalid')
        await transaction(
          db,
          'readwrite',
          async (tx) => {
            await requestValue(tx.objectStore(ROW_TRANSFER_STAGE).add(row))
          },
          [ROW_TRANSFER_STAGE]
        )
      } catch (error) {
        phase = 'failed'
        throw error
      }
    })
  }
  return {
    appendThread: (thread) => append({ stageId, kind: 'thread', id: thread.threadId, value: thread }),
    appendMessage: (message) => append({ stageId, kind: 'message', id: message.messageId, value: message }),
    publish: () =>
      enqueue(async () => {
        if (phase !== 'collecting') throw new Error('Row candidate is closed')
        try {
          await transaction(
            db,
            'readwrite',
            async (tx) => {
              assertRevision(sessionId, expectedRevision, storedRevision(await head(tx, sessionId)))
              let activeThreads = 0
              const stage = tx.objectStore(ROW_TRANSFER_STAGE)
              await visitStage(tx, stageId, async (entry) => {
                if (entry.kind !== 'thread') return
                const thread = entry.value
                if (thread.seq === -1) {
                  activeThreads++
                  if (thread.threadId !== commit.record.activeThreadId)
                    throw new Error('Active copied thread is missing')
                }
                let next = thread.rootMessageId
                let parent: string | null = null
                let depth = 0
                while (next !== null) {
                  const message = await requestValue<StageMessage | undefined>(stage.get([stageId, 'message', next]))
                  if (
                    !message ||
                    message.value.threadId !== thread.threadId ||
                    message.value.parentMessageId !== parent ||
                    message.value.selected
                  )
                    throw new Error('Invalid selected row path')
                  message.value.selected = true
                  message.selectedDepth = depth++
                  await requestValue(stage.put(message))
                  parent = next
                  next = message.value.activeChildId
                }
                if (parent !== thread.activeLeafMessageId) throw new Error('Invalid selected row leaf')
              })
              if (activeThreads !== 1) throw new Error('Active copied thread is missing')
              for (const store of [
                THREADS,
                MESSAGES,
                TRANSCRIPT_THREADS,
                TRANSCRIPT_MESSAGES,
                SESSION_ROW_TOKEN_CACHE_STORE,
              ])
                await requestValue(tx.objectStore(store).delete(sessionRange(sessionId)))
              await visitStage(tx, stageId, (entry) => {
                if (entry.kind === 'thread') {
                  tx.objectStore(THREADS).put(entry.value)
                  putTranscriptThread(tx, entry.value)
                } else {
                  const row = {
                    ...entry.value,
                    selected: entry.value.selected ?? false,
                    selectedDepth: entry.selectedDepth ?? null,
                  }
                  tx.objectStore(MESSAGES).put(row)
                  putTranscriptMessage(tx, row)
                }
              })
              await requestValue(tx.objectStore(THREADS).put(revisionHead(sessionId, commit)))
              await requestValue(tx.objectStore(ROW_TRANSFER_STAGE).delete(sessionRange(stageId)))
            },
            [...ROW_STORES, ROW_TRANSFER_STAGE]
          )
          phase = 'published'
        } catch (error) {
          phase = 'failed'
          throw error
        }
      }),
    dispose: () =>
      enqueue(async () => {
        if (phase === 'disposed') return
        await transaction(
          db,
          'readwrite',
          async (tx) => {
            await requestValue(tx.objectStore(ROW_TRANSFER_STAGE).delete(sessionRange(stageId)))
          },
          [ROW_TRANSFER_STAGE]
        )
        phase = 'disposed'
      }),
  }
}
