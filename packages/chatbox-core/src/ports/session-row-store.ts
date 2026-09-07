import type { MessageRow, MessageRowStatus, SessionRecordV2, ThreadRow } from '../session/session-tree/types'

export interface SessionRows {
  sessionId: string
  threads: ThreadRow[]
  messages: MessageRow[]
}

export interface SessionRowsDiff {
  sessionId: string
  threads: { upsert: ThreadRow[]; delete: string[] }
  messages: { upsert: MessageRow[]; delete: string[] }
}

/** Metadata committed atomically with one visible row mutation. */
export interface SessionRowCommit {
  record: SessionRecordV2
  revision: number
}

/** One complete, internally consistent row-store snapshot. */
export interface SessionRowSnapshot extends SessionRowCommit {
  rows: SessionRows
}

export interface GeneratingMessageRef {
  sessionId: string
  threadId: string
  messageId: string
}

export type SessionRowStoreOperation =
  | 'initialize'
  | 'read-rows'
  | 'write-rows'
  | 'apply-diff'
  | 'delete-rows'
  | 'has-rows'
  | 'get-revision'
  | 'list-session-ids'
  | 'upsert-message'
  | 'find-messages-by-status'

export class SessionRowStoreError extends Error {
  readonly name = 'SessionRowStoreError'

  constructor(
    readonly operation: SessionRowStoreOperation,
    readonly cause: unknown,
    readonly sessionId?: string
  ) {
    super(`Session row store operation failed: ${operation}${sessionId ? ` (${sessionId})` : ''}`)
  }
}

export class SessionRowConflictError extends Error {
  readonly name = 'SessionRowConflictError'

  constructor(
    readonly sessionId: string,
    readonly expectedRevision: number | null,
    readonly actualRevision: number | null
  ) {
    super(`Session row revision conflict for ${sessionId}`)
  }
}

/**
 * Thread rows and message rows of a session. A published mutation must expose
 * either the complete old snapshot or the complete new snapshot; drivers may
 * use invisible staging transactions before one atomic publish transaction.
 */
export interface SessionRowStorePort {
  initialize(): Promise<void>
  /** Rows, record and revision from one committed snapshot; null when the session has no visible rows. */
  readSnapshot(sessionId: string): Promise<SessionRowSnapshot | null>
  /** Replaces the session's rows and commit metadata atomically. */
  writeRows(snapshot: SessionRowSnapshot, expectedRevision?: number | null): Promise<void>
  /** Applies a diff and publishes its commit metadata atomically. */
  applyDiff(diff: SessionRowsDiff, commit: SessionRowCommit, expectedRevision?: number): Promise<void>
  /** Deletes a session only when its committed revision still matches, when provided. */
  deleteRows(sessionId: string, expectedRevision?: number | null): Promise<void>
  hasRows(sessionId: string): Promise<boolean>
  /** Durable generation used by CAS; deletion advances it even while no rows are visible. */
  getRevision(sessionId: string): Promise<number | null>
  /** Ids of sessions holding at least one thread row or message row. */
  listSessionIds(): Promise<string[]>
  /** Single-row fast path for streaming checkpoints; inserts when absent. */
  upsertMessage(row: MessageRow): Promise<void>
  /** Startup repair scan; returns references only, without loading payloads. */
  findMessagesByStatus(status: MessageRowStatus): Promise<GeneratingMessageRef[]>
}
