import { MESSAGE_TREE } from './session-row-idb-tree'
import { messageMetadata } from './session-row-idb-messages'
import {
  type SessionRowCommit,
  SessionRowConflictError,
  type SessionRowImportWriter,
  type SessionRowImportIssueHandler,
  type SessionRowImportPreparation,
  type SessionStoredRow,
  sessionImportCandidateId,
} from '@chatbox/core/ports'
import { deriveMessageFacts } from '@chatbox/core/session/session-tree'
import type { MessageRow, MessageRowMetadata, ThreadRow } from '@chatbox/core/session/session-tree'
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
import { putTranscriptMessage, putTranscriptThread, TRANSCRIPT_THREADS } from './session-row-idb-transcript'

type Phase = 'collecting' | 'ready' | 'published'
interface Control {
  stageId: string
  kind: 'control'
  id: ''
  jobId: string
  commit: SessionRowCommit
  expectedRevision: number | null
  phase: Phase
  version: number
}
interface Meta {
  value: MessageRowMetadata
  pathDepth: number | null
}
interface ImportIndex {
  version: number
  threads: Map<string, ThreadRow>
  messages: Map<string, Meta>
  prepared?: SessionRowImportPreparation
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
const visibleStores = [THREADS, MESSAGES, TRANSCRIPT_THREADS, MESSAGE_TREE, SESSION_ROW_TOKEN_CACHE_STORE]
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
function emptyIndex(version: number): ImportIndex {
  return { version, threads: new Map(), messages: new Map() }
}
async function readIndex(store: IDBObjectStore, control: Control): Promise<ImportIndex> {
  const index = emptyIndex(control.version)
  await visitBatches<ThreadEntry>(store, control.stageId, 'thread', (entries) => {
    for (const entry of entries) index.threads.set(entry.id, entry.value)
  })
  await visitBatches<MessageEntry>(store, control.stageId, 'message', (entries) => {
    for (const entry of entries) index.messages.set(entry.id, messageMeta(entry.value))
  })
  return index
}
function validateCommit(commit: SessionRowCommit, expected: number | null, jobId: string) {
  if (
    !jobId ||
    !commit.record.id ||
    !commit.record.activeThreadId ||
    commit.record.rowFormatVersion !== 3 ||
    !Number.isSafeInteger(commit.revision) ||
    (expected !== null && (!Number.isSafeInteger(expected) || expected < 1)) ||
    commit.revision !== (expected ?? 0) + 1
  )
    throw new Error('Invalid import candidate commit')
}

export async function stageIndexedDBImportRows(
  db: IDBDatabase,
  input: SessionRowCommit,
  expectedRevision: number | null,
  jobId: string
): Promise<SessionRowImportWriter> {
  const commit = { record: structuredClone(input.record), revision: input.revision }
  validateCommit(commit, expectedRevision, jobId)
  const id = sessionImportCandidateId(jobId, commit.record.id)
  await transaction(
    db,
    'readwrite',
    async (tx) => {
      const actual = storedRevision(await head(tx, commit.record.id))
      if (actual !== expectedRevision) throw new SessionRowConflictError(commit.record.id, expectedRevision, actual)
      tx.objectStore(ROW_TRANSFER_STAGE).add({
        stageId: id,
        kind: 'control',
        id: '',
        jobId,
        commit,
        expectedRevision,
        phase: 'collecting',
        version: 0,
      } satisfies Control)
    },
    [THREADS, ROW_TRANSFER_STAGE]
  )
  return resumeIndexedDBImportRows(db, id, true)
}

export async function resumeIndexedDBImportRows(
  db: IDBDatabase,
  id: string,
  allowConvertedForks = false
): Promise<SessionRowImportWriter> {
  const getControl = (tx: IDBTransaction) =>
    requestValue<Control | undefined>(tx.objectStore(ROW_TRANSFER_STAGE).get([id, 'control', '']))
  const initial = await transaction(db, 'readonly', getControl, [ROW_TRANSFER_STAGE])
  if (!initial) throw new Error('Import candidate is missing')
  const commit = initial.commit
  const sessionId = commit.record.id
  let index: ImportIndex | undefined = allowConvertedForks ? emptyIndex(initial.version) : undefined
  let tail: Promise<void> = Promise.resolve()
  let rowsChanged = false
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work).catch((error: unknown) => {
      index = undefined
      throw error
    })
    tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
  const requireControl = async (tx: IDBTransaction) => {
    const control = await getControl(tx)
    if (!control) throw new Error('Import candidate is missing')
    return control
  }
  const requireIndex = async (tx: IDBTransaction, control: Control) => {
    if (!index || index.version !== control.version) {
      index = await readIndex(tx.objectStore(ROW_TRANSFER_STAGE), control)
      rowsChanged = true
    }
    return index
  }
  const appendRows = (inputRows: readonly SessionStoredRow[], onIssue?: SessionRowImportIssueHandler) => {
    const rows = structuredClone(inputRows)
    const report: SessionRowImportIssueHandler = (issue) => {
      rowsChanged = true
      onIssue?.(issue)
    }
    return enqueue(() =>
      transaction(
        db,
        'readwrite',
        async (tx) => {
          const control = await requireControl(tx)
          if (control.phase !== 'collecting') throw new Error('Import candidate is closed')
          const current = await requireIndex(tx, control)
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
          control.version++
          store.put(control)
          current.version = control.version
        },
        [ROW_TRANSFER_STAGE]
      )
    )
  }
  return {
    candidateId: id,
    commit,
    appendRows,
    appendThread: (thread) => appendRows([{ kind: 'thread', thread }]),
    appendMessage: (message) => appendRows([{ kind: 'message', message }]),
    prepare: (onIssue, forks) =>
      enqueue(async () => {
        const prepared = await transaction(
          db,
          'readwrite',
          async (tx) => {
            const control = await requireControl(tx)
            if (control.phase === 'ready' || control.phase === 'published') return
            const current = await requireIndex(tx, control)
            current.prepared = prepareImportIndex(
              current,
              control.commit,
              onIssue,
              allowConvertedForks && !rowsChanged ? forks : undefined,
              { reservedThreadId: REVISION_HEAD_THREAD_ID }
            )
            control.phase = 'ready'
            control.version++
            tx.objectStore(ROW_TRANSFER_STAGE).put(control)
            current.version = control.version
            return { result: current.prepared, record: control.commit.record }
          },
          [ROW_TRANSFER_STAGE]
        )
        if (prepared) {
          commit.record = prepared.record
          return prepared.result
        }
      }),
    publish: () =>
      enqueue(async () => {
        const record = await transaction(
          db,
          'readwrite',
          async (tx) => {
            const control = await requireControl(tx)
            if (control.phase === 'published') return control.commit.record
            if (control.phase !== 'ready') throw new Error('Import candidate is not prepared')
            const actual = storedRevision(await head(tx, sessionId))
            if (actual !== control.expectedRevision)
              throw new SessionRowConflictError(sessionId, control.expectedRevision, actual)
            const current = await requireIndex(tx, control)
            current.prepared ??= prepareImportIndex(current, control.commit, undefined, undefined, {
              reservedThreadId: REVISION_HEAD_THREAD_ID,
            })
            for (const name of visibleStores) tx.objectStore(name).delete(sessionRange(sessionId))
            for (const thread of current.threads.values()) {
              tx.objectStore(THREADS).put(thread)
              putTranscriptThread(tx, thread)
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
            tx.objectStore(THREADS).put(revisionHead(sessionId, control.commit))
            stage.delete(allRange(id))
            control.phase = 'published'
            control.version++
            stage.put(control)
            return control.commit.record
          },
          [...ROW_STORES, ROW_TRANSFER_STAGE]
        )
        commit.record = record
        index = undefined
      }),
    dispose: () =>
      enqueue(async () => {
        await transaction(
          db,
          'readwrite',
          async (tx) => {
            tx.objectStore(ROW_TRANSFER_STAGE).delete(allRange(id))
          },
          [ROW_TRANSFER_STAGE]
        )
        index = undefined
      }),
  }
}
