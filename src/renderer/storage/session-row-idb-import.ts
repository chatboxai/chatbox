import { MESSAGE_TREE } from './session-row-idb-tree'
import { messageMetadata } from './session-row-idb-messages'
import {
  type SessionRowCommit,
  type SessionRowImportWriter,
  type SessionRowImportIssueHandler,
  type SessionRowImportPreparation,
  type SessionStoredRow,
  sessionImportCandidateId,
} from '@chatbox/core/ports'
import { deriveMessageFacts } from '@chatbox/core/session/session-tree'
import type { MessageRow, MessageRowMetadata, SessionRecordV2, ThreadRow } from '@chatbox/core/session/session-tree'
import { prepareImportIndex, validateMessageRow, validateThreadRow } from '@chatbox/core/persistence'
import { requestValue, transaction } from './session-row-idb-transfer'
import {
  ROW_STORES,
  ROW_TRANSFER_STAGE,
  SESSION_ROW_THREAD_STORE as THREADS,
  SESSION_ROW_MESSAGE_STORE as MESSAGES,
  SESSION_ROW_TOKEN_CACHE_STORE,
  REVISION_HEAD_THREAD_ID,
  type RevisionHeadRow,
  revisionHead,
  storedRevision,
} from './session-row-idb-records'
import { putTranscriptMessage } from './session-row-idb-transcript'

type Phase = 'collecting' | 'ready' | 'published' | 'failed' | 'disposed'
interface Meta {
  value: MessageRowMetadata
  pathDepth: number | null
}
interface ImportIndex {
  threads: Map<string, ThreadRow>
  messages: Map<string, Meta>
}
interface ThreadEntry {
  stageId: string
  kind: 'thread'
  id: string
  value: ThreadRow
}
interface MessageEntry {
  stageId: string
  kind: 'message'
  id: string
  value: MessageRow
}
const PAGE_SIZE = 128
const allRange = (id: string) => IDBKeyRange.bound([id], [id, []])
const kindRange = (id: string, kind: string) => IDBKeyRange.bound([id, kind], [id, kind, []])
const sessionRange = (id: string) => IDBKeyRange.bound([id], [id, []])
const visibleStores = [THREADS, MESSAGES, MESSAGE_TREE, SESSION_ROW_TOKEN_CACHE_STORE]
const head = (tx: IDBTransaction, sessionId: string) =>
  requestValue<RevisionHeadRow | undefined>(tx.objectStore(THREADS).get([sessionId, REVISION_HEAD_THREAD_ID]))

async function visitBatches<Entry extends { id: string }>(
  store: IDBObjectStore,
  id: string,
  kind: string,
  visit: (entries: Entry[]) => void
) {
  let range = kindRange(id, kind)
  while (true) {
    const entries = await requestValue<Entry[]>(store.getAll(range, PAGE_SIZE))
    if (!entries.length) return
    visit(entries)
    if (entries.length < PAGE_SIZE) return
    range = IDBKeyRange.bound([id, kind, entries[entries.length - 1].id], [id, kind, []], true)
  }
}

function messageMeta(row: MessageRow): Meta {
  const { message: _body, ...value } = row
  return { value, pathDepth: null }
}
function emptyIndex(): ImportIndex {
  return { threads: new Map(), messages: new Map() }
}
function validateRecord(record: SessionRecordV2, jobId: string) {
  if (!jobId || !record.id || !record.activeThreadId || record.rowFormatVersion !== 3)
    throw new Error('Invalid import candidate record')
}

export async function stageIndexedDBImportRows(
  db: IDBDatabase,
  input: SessionRecordV2,
  jobId: string
): Promise<SessionRowImportWriter> {
  const commit = { record: structuredClone(input), revision: 1 }
  validateRecord(commit.record, jobId)
  const id = sessionImportCandidateId(jobId, commit.record.id)
  return createImportWriter(db, id, commit)
}

export async function disposeIndexedDBImportRows(db: IDBDatabase, id: string): Promise<void> {
  await transaction(
    db,
    'readwrite',
    async (tx) => {
      tx.objectStore(ROW_TRANSFER_STAGE).delete(allRange(id))
    },
    [ROW_TRANSFER_STAGE]
  )
}

function createImportWriter(db: IDBDatabase, id: string, commit: SessionRowCommit): SessionRowImportWriter {
  const sessionId = commit.record.id
  let phase: Phase = 'collecting'
  let index: ImportIndex | undefined = emptyIndex()
  let prepared: SessionRowImportPreparation | undefined
  let tail: Promise<void> = Promise.resolve()
  let rowsChanged = false
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work)
    tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
  const requireIndex = () => {
    if (phase === 'failed') throw new Error('Import candidate has failed')
    if (phase === 'disposed') throw new Error('Import candidate is missing')
    if (!index) throw new Error('Import candidate is closed')
    return index
  }
  const fail = (error: unknown): never => {
    phase = 'failed'
    index = undefined
    throw error
  }
  const appendRows = (inputRows: readonly SessionStoredRow[], onIssue?: SessionRowImportIssueHandler) => {
    const rows = structuredClone(inputRows)
    const report: SessionRowImportIssueHandler = (issue) => {
      rowsChanged = true
      onIssue?.(issue)
    }
    return enqueue(async () => {
      const current = requireIndex()
      if (phase !== 'collecting') throw new Error('Import candidate is closed')
      await transaction(
        db,
        'readwrite',
        async (tx) => {
          const store = tx.objectStore(ROW_TRANSFER_STAGE)
          for (const row of rows) {
            const rowId = row.kind === 'thread' ? row.thread.threadId : row.message.messageId
            if (row.kind === 'thread' ? current.threads.has(rowId) : current.messages.has(rowId)) {
              report({ action: 'skipped', entity: row.kind, id: rowId, reason: 'duplicate-row' })
              continue
            }
            if (row.kind === 'message' && !current.threads.has(row.message.threadId)) {
              report({ action: 'skipped', entity: 'message', id: rowId, reason: 'missing-thread' })
              continue
            }
            try {
              if (row.kind === 'thread') {
                validateThreadRow(row.thread, sessionId)
                if (
                  row.thread.threadId === REVISION_HEAD_THREAD_ID ||
                  !Number.isSafeInteger(row.thread.threadOrder) ||
                  row.thread.threadOrder < -1
                )
                  throw new Error('Invalid thread identity or order')
              } else {
                validateMessageRow(row.message, sessionId)
                if (
                  row.message.message.id !== row.message.messageId ||
                  !Number.isSafeInteger(row.message.siblingOrder) ||
                  row.message.siblingOrder < 0
                )
                  throw new Error('Invalid message identity or order')
              }
            } catch {
              report({ action: 'skipped', entity: row.kind, id: rowId, reason: 'invalid-row' })
              continue
            }
            if (row.kind === 'thread') {
              const thread = { ...row.thread, activeLeafMessageId: null, summary: undefined, control: undefined }
              store.add({ stageId: id, kind: 'thread', id: rowId, value: thread } satisfies ThreadEntry)
              current.threads.set(rowId, thread)
            } else {
              const message = row.message
              message.status = 'settled'
              message.facts = deriveMessageFacts(message.message)
              message.selected = false
              delete message.fork
              store.add({ stageId: id, kind: 'message', id: rowId, value: message } satisfies MessageEntry)
              current.messages.set(rowId, messageMeta(message))
            }
          }
        },
        [ROW_TRANSFER_STAGE]
      ).catch(fail)
    })
  }
  return {
    candidateId: id,
    record: commit.record,
    appendRows,
    appendThread: (thread) => appendRows([{ kind: 'thread', thread }]),
    appendMessage: (message) => appendRows([{ kind: 'message', message }]),
    prepare: (onIssue, forks) =>
      enqueue(async () => {
        if (phase === 'ready' || phase === 'published') return prepared
        const current = requireIndex()
        try {
          prepared = prepareImportIndex(current, commit, onIssue, !rowsChanged ? forks : undefined, {
            reservedThreadId: REVISION_HEAD_THREAD_ID,
          })
          phase = 'ready'
          return prepared
        } catch (error) {
          fail(error)
        }
      }),
    publish: () =>
      enqueue(async () => {
        if (phase === 'published') return
        const current = requireIndex()
        if (phase !== 'ready') throw new Error('Import candidate is not prepared')
        await transaction(
          db,
          'readwrite',
          async (tx) => {
            const actual = storedRevision(await head(tx, sessionId))
            if (actual !== null && (!Number.isSafeInteger(actual) || actual < 1))
              throw new Error('Session row revision is invalid')
            if (actual === Number.MAX_SAFE_INTEGER) throw new Error('Session row revision is exhausted')
            commit.revision = (actual ?? 0) + 1
            for (const name of visibleStores) tx.objectStore(name).delete(sessionRange(sessionId))
            for (const thread of current.threads.values()) {
              tx.objectStore(THREADS).put(thread)
            }
            const stage = tx.objectStore(ROW_TRANSFER_STAGE)
            await visitBatches<MessageEntry>(stage, id, 'message', (entries) => {
              for (const entry of entries) {
                const meta = current.messages.get(entry.id)
                if (!meta) continue
                const message = { ...meta.value, message: entry.value.message }
                tx.objectStore(MESSAGES).put({ ...messageMetadata(message), message: message.message })
                putTranscriptMessage(tx, message)
              }
            })
            tx.objectStore(THREADS).put(revisionHead(sessionId, commit))
            stage.delete(allRange(id))
          },
          [...ROW_STORES, ROW_TRANSFER_STAGE]
        )
        phase = 'published'
        index = undefined
      }),
    dispose: () =>
      enqueue(async () => {
        if (phase === 'published' || phase === 'disposed') {
          phase = 'disposed'
          return
        }
        await disposeIndexedDBImportRows(db, id)
        phase = 'disposed'
        index = undefined
      }),
  }
}
