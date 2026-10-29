import type { SessionRowCommit } from '@chatbox/core/ports'
import type { SessionRecordV2, ThreadRow } from '@chatbox/core/session/session-tree'

export const SESSION_ROW_DB_NAME = 'chatbox-messages'
export const SESSION_ROW_THREAD_STORE = 'threads'
export const SESSION_ROW_MESSAGE_STORE = 'messages'
export const SESSION_ROW_TOKEN_CACHE_STORE = 'tokenCache'
export const ROW_TRANSFER_STAGE = 'rowTransferStage'

export const SESSION_INDEX = 'bySession'
export const THREAD_ORDER_INDEX = 'byThreadOrder'
export const STATUS_INDEX = 'byStatus'
export const ROW_STORES = [
  SESSION_ROW_THREAD_STORE,
  SESSION_ROW_MESSAGE_STORE,
  SESSION_ROW_TOKEN_CACHE_STORE,
  'messageTree',
]
export const REVISION_HEAD_THREAD_ID = '__chatbox_internal_revision_head__'

export interface RevisionHeadRow {
  sessionId: string
  threadId: typeof REVISION_HEAD_THREAD_ID
  threadOrder: -2
  commitRevision: number
  sessionRecord?: SessionRecordV2
}

export function isRevisionHeadRow(row: ThreadRow | RevisionHeadRow): row is RevisionHeadRow {
  return row.threadOrder === -2 && row.threadId === REVISION_HEAD_THREAD_ID
}

export function storedRevision(row: ThreadRow | RevisionHeadRow | undefined): number | null {
  return row && isRevisionHeadRow(row) ? row.commitRevision : null
}

export function revisionHead(sessionId: string, commit: SessionRowCommit): RevisionHeadRow {
  return {
    sessionId,
    threadId: REVISION_HEAD_THREAD_ID,
    threadOrder: -2,
    commitRevision: commit.revision,
    sessionRecord: commit.record,
  }
}

export function revisionTombstone(sessionId: string, revision: number): RevisionHeadRow {
  return { sessionId, threadId: REVISION_HEAD_THREAD_ID, threadOrder: -2, commitRevision: revision }
}

export function readStoredCommit(
  sessionId: string,
  threads: ThreadRow[],
  head: RevisionHeadRow | undefined
): SessionRowCommit {
  const activeRows = threads.filter((thread) => thread.threadOrder === -1)
  if (activeRows.length !== 1) {
    throw new Error(`session ${sessionId} must have exactly one active thread row`)
  }
  const active = activeRows[0]
  const record = head?.sessionRecord
  const revision = head?.commitRevision
  if (!record || revision === undefined) {
    throw new Error(`session ${sessionId} rows have no commit metadata`)
  }
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error(`session ${sessionId} has an invalid commit revision`)
  }
  if (record.id !== sessionId || record.activeThreadId !== active.threadId) {
    throw new Error(`session ${sessionId} commit metadata does not match its active thread`)
  }
  return { record, revision }
}
