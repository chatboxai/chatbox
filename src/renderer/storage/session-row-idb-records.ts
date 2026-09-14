import type { SessionRowCommit } from '@chatbox/core/ports'
import type { SessionRecordV2, ThreadRow } from '@chatbox/core/session/session-tree'

export const SESSION_ROW_DB_NAME = 'chatbox-messages'
export const SESSION_ROW_THREAD_STORE = 'threads'
export const SESSION_ROW_MESSAGE_STORE = 'messages'

export const SESSION_INDEX = 'bySession'
export const STATUS_INDEX = 'byStatus'
export const ROW_STORES: Array<typeof SESSION_ROW_THREAD_STORE | typeof SESSION_ROW_MESSAGE_STORE> = [
  SESSION_ROW_THREAD_STORE,
  SESSION_ROW_MESSAGE_STORE,
]
export const REVISION_HEAD_THREAD_ID = '__chatbox_internal_revision_head__'

export interface RevisionHeadRow {
  sessionId: string
  threadId: typeof REVISION_HEAD_THREAD_ID
  seq: -2
  commitRevision: number
  sessionRecord?: SessionRecordV2
}

export interface PersistedThreadRow extends ThreadRow {
  sessionRecord?: SessionRecordV2
  commitRevision?: number
}

export function isRevisionHeadRow(row: PersistedThreadRow | RevisionHeadRow): row is RevisionHeadRow {
  return row.seq === -2 && row.threadId === REVISION_HEAD_THREAD_ID
}

export function storedRevision(row: PersistedThreadRow | RevisionHeadRow | undefined): number | null {
  return row && isRevisionHeadRow(row) ? row.commitRevision : null
}

export function revisionHead(sessionId: string, commit: SessionRowCommit): RevisionHeadRow {
  return {
    sessionId,
    threadId: REVISION_HEAD_THREAD_ID,
    seq: -2,
    commitRevision: commit.revision,
    sessionRecord: commit.record,
  }
}

export function revisionTombstone(sessionId: string, revision: number): RevisionHeadRow {
  return { sessionId, threadId: REVISION_HEAD_THREAD_ID, seq: -2, commitRevision: revision }
}

export function plainThreadRow(row: PersistedThreadRow): ThreadRow {
  const { sessionRecord: _sessionRecord, commitRevision: _commitRevision, ...thread } = row
  return thread
}

export function readStoredCommit(
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
