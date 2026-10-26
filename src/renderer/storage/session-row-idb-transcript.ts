import { v4 as uuid } from 'uuid'
import {
  navigationProjection,
  readBranchMessagesPage,
  validateBranchMessagesRequest,
  validateNavigationRepair,
  readNavigationPage,
  readTranscriptPage,
  transcriptOrder,
  transcriptThread,
  assertTranscriptRevision,
  validateTranscriptRequest,
  type TranscriptMessageMetadata,
  type SessionTranscriptReader,
} from '@chatbox/core/persistence'
import type {
  SessionMessageNavigationProjection,
  SessionBranchMessagesRequest,
  SessionNavigationPage,
  SessionNavigationRepairRequest,
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
  MESSAGE_STAGE,
  MESSAGE_ORDER_INDEX,
  OLD_PARENT_ORDER,
  SELECTED_ROLE,
  SELECTED_KIND,
  SELECTED_PAUSED,
  SELECTED_CONVERSATION,
  SELECTED_NAMING,
  ROW_STORES,
  SESSION_ROW_MESSAGE_STORE,
  SESSION_ROW_THREAD_STORE,
  SESSION_INDEX,
  isRevisionHeadRow,
  type RevisionHeadRow,
} from './session-row-idb-records'

export const TRANSCRIPT_THREADS = 'transcriptThreads'
export const TRANSCRIPT_MESSAGES = 'transcriptMessages'
export const RELATION_CHILDREN = 'byParentOrder'
export const RELATION_BRANCH = 'byParentBranchOrder'
export const SELECTED_ORDER = 'bySelectedOrder'
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
    order: transcriptOrder(row.seq),
    searchOrder: row.seq === -1 ? -Number.MAX_SAFE_INTEGER : -row.seq,
  } satisfies StoredTranscriptThread)
}

export function putTranscriptMessage(
  tx: IDBTransaction,
  row: StoredMessageRow,
  projection?: SessionMessageNavigationProjection,
  payloadBytes?: number
): void {
  const { message, ...metadata } = row
  tx.objectStore(TRANSCRIPT_MESSAGES).put({
    ...metadata,
    tokenPayloadId: uuid(),
    parentKey: row.parentMessageId ?? '',
    branchKey: row.branchId ?? '',
    pausedKey: Number(row.facts?.paused ?? false),
    namingRole: row.facts?.autoTitleEligible ? row.facts.role : '',
    conversationKey: Number(row.kind !== 'summary' && row.facts?.role !== 'system' && !row.facts?.isForkMarker),
    payloadBytes: payloadBytes ?? new TextEncoder().encode(JSON.stringify(message)).length,
    ...(projection ? { navigation: projection } : message ? { navigation: navigationProjection(message) } : {}),
  })
}

export function createTranscriptStores(db: IDBDatabase, tx: IDBTransaction): void {
  if (!db.objectStoreNames.contains(TRANSCRIPT_THREADS)) {
    const threads = db.createObjectStore(TRANSCRIPT_THREADS, { keyPath: ['sessionId', 'threadId'] })
    threads.createIndex(SESSION_INDEX, 'sessionId')
    threads.createIndex(THREAD_SUMMARY_ORDER, ['sessionId', 'searchOrder', 'threadId'])
    threads.createIndex(NONEMPTY_ORDER, ['sessionId', 'nonempty', 'order', 'threadId'])
  }
  if (!db.objectStoreNames.contains(TRANSCRIPT_MESSAGES)) {
    const messages = db.createObjectStore(TRANSCRIPT_MESSAGES, { keyPath: ['sessionId', 'messageId'] })
    messages.createIndex(SESSION_INDEX, 'sessionId')
    messages.createIndex(MESSAGE_ORDER_INDEX, ['sessionId', 'threadId', 'seq', 'messageId'])
    messages.createIndex(RELATION_CHILDREN, ['sessionId', 'threadId', 'parentKey', 'seq', 'messageId'])
    messages.createIndex(RELATION_BRANCH, ['sessionId', 'threadId', 'parentKey', 'branchKey', 'seq', 'messageId'])
    messages.createIndex(SELECTED_ORDER, ['sessionId', 'threadId', 'selectedDepth', 'messageId'])
  }
  if (!db.objectStoreNames.contains(MESSAGE_STAGE)) {
    const stage = db.createObjectStore(MESSAGE_STAGE, { keyPath: ['sessionId', 'messageId'] })
    stage.createIndex(SESSION_INDEX, 'sessionId')
    stage.createIndex(RELATION_CHILDREN, ['sessionId', 'threadId', 'parentKey', 'seq', 'messageId'])
    stage.createIndex(SELECTED_ORDER, ['sessionId', 'threadId', 'selectedDepth', 'messageId'])
    stage.createIndex(OLD_PARENT_ORDER, ['sessionId', 'oldThreadId', 'oldParentKey', 'oldSeq', 'messageId'])
  }
  for (const name of [TRANSCRIPT_MESSAGES, MESSAGE_STAGE]) {
    const store = tx.objectStore(name)
    if (!store.indexNames.contains(SELECTED_NAMING))
      store.createIndex(SELECTED_NAMING, ['sessionId', 'threadId', 'namingRole', 'selectedDepth', 'messageId'])
    if (!store.indexNames.contains(SELECTED_ROLE))
      store.createIndex(SELECTED_ROLE, ['sessionId', 'threadId', 'facts.role', 'selectedDepth', 'messageId'])
    if (!store.indexNames.contains(SELECTED_PAUSED))
      store.createIndex(SELECTED_PAUSED, ['sessionId', 'threadId', 'pausedKey', 'selectedDepth', 'messageId'])
    if (!store.indexNames.contains(SELECTED_CONVERSATION))
      store.createIndex(SELECTED_CONVERSATION, [
        'sessionId',
        'threadId',
        'conversationKey',
        'selectedDepth',
        'messageId',
      ])
    if (!store.indexNames.contains(SELECTED_KIND))
      store.createIndex(SELECTED_KIND, ['sessionId', 'threadId', 'kind', 'selectedDepth', 'messageId'])
  }
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
      const key = thread ? [sessionId, 1, transcriptOrder(thread.seq), thread.threadId] : null
      const range =
        direction === 'after'
          ? IDBKeyRange.bound(key ?? lower, upper, key !== null, false)
          : IDBKeyRange.bound(lower, key ?? upper, false, key !== null)
      const cursor = await requestValue<IDBCursorWithValue | null>(
        threads.index(NONEMPTY_ORDER).openCursor(range, direction === 'after' ? 'next' : 'prev')
      )
      return plainTranscriptThread(cursor?.value as StoredTranscriptThread | undefined)
    },
    message: async (id) =>
      (await requestValue<TranscriptMessageMetadata | undefined>(
        tx.objectStore(TRANSCRIPT_MESSAGES).get([sessionId, id])
      )) ?? null,
    payloads: async (ids) => {
      const result: MessageRow[] = []
      for (const id of ids) {
        const row = await requestValue<StoredMessageRow | undefined>(
          tx.objectStore(SESSION_ROW_MESSAGE_STORE).get([sessionId, id])
        )
        if (!row) throw new Error('Transcript payload is missing')
        result.push(await new Promise<MessageRow>((resolve, reject) => readStoredMessage(tx, row, resolve, reject)))
      }
      return result
    },
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

export function readIndexedDBNavigation(
  db: IDBDatabase,
  request: SessionTranscriptRequest
): Promise<SessionNavigationPage | null> {
  validateTranscriptRequest(request)
  return readTranscriptTransaction(db, async (tx) => {
    const commit = await readTranscriptCommit(tx, request.sessionId)
    assertTranscriptRevision(request, commit?.revision ?? (await readRevision(tx, request.sessionId)))
    return commit ? readNavigationPage(request, commit, reader(tx, request.sessionId)) : null
  })
}

export function repairIndexedDBNavigation(db: IDBDatabase, request: SessionNavigationRepairRequest): Promise<void> {
  validateNavigationRepair(request)
  return readTranscriptTransaction(
    db,
    async (tx) => {
      assertTranscriptRevision(request, await readRevision(tx, request.sessionId))
      const source = reader(tx, request.sessionId)
      for (const id of new Set(request.messageIds)) {
        const metadata = await source.message(id)
        if (!metadata || metadata.navigation) continue
        const [row] = await source.payloads([id])
        tx.objectStore(TRANSCRIPT_MESSAGES).put({ ...metadata, navigation: navigationProjection(row.message) })
      }
    },
    'readwrite'
  )
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
