import type {
  MessageRow,
  MessageRowMetadata,
  MessageRowStatus,
  SessionRecordV2,
  ThreadRow,
} from '../session/session-tree/types'
import type { SessionContextRequest, SessionContextRows } from './session-context-source'
import type { SessionTextTokenRead, SessionTextTokenStorePort } from './session-text-tokens'

export interface SessionRows {
  sessionId: string
  threads: ThreadRow[]
  messages: MessageRow[]
}

export interface SessionStructureSnapshot extends SessionRowCommit {
  threads: ThreadRow[]
  messages: MessageRowMetadata[]
}

export interface SessionRowsDiff {
  /** Structural edits retain the committed payload and require an expected revision. */
  messageMetadataUpsert?: MessageRowMetadata[]
  /** Upserted rows with payloads identical to the expected revision. Stores may reuse those payloads only under CAS. */
  unchangedPayloadMessageIds?: string[]
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
  textTokens?: SessionTextTokenRead
}

/** Opaque continuation of one thread's active path at one committed revision. */
interface SessionMessageWindowIdentity {
  sessionId: string
  threadId: string
  revision: number
}

export type SessionMessageWindowCursor = SessionMessageWindowIdentity &
  ({ beforeMessageId: string; afterMessageId?: never } | { afterMessageId: string; beforeMessageId?: never })

export interface SessionMessageWindowRequest {
  sessionId: string
  /** Defaults to the active thread for a first page, or the cursor's thread. */
  threadId?: string
  /** Number of messages, from 1 to 200. Payload bytes may vary per message. */
  limit: number
  /** First window origin; mutually exclusive with a continuation cursor. Defaults to tail. */
  edge?: 'head' | 'tail'
  cursor?: SessionMessageWindowCursor
  /** Fence the first window of another thread to an existing read snapshot. */
  expectedRevision?: number
}

/** Read-only partial view; never pass a window to a complete-session write API. */
export interface SessionMessageWindow extends SessionRowCommit {
  textTokens?: SessionTextTokenRead
  thread: ThreadRow
  /** Active-path messages in chronological order, including summary rows. */
  messages: MessageRow[]
  older: SessionMessageWindowCursor | null
  newer: SessionMessageWindowCursor | null
}

/** Active thread first, followed by archived threads in reverse archive order. */
export interface SessionThreadPageCursor {
  sessionId: string
  revision: number
  offset: number
}

export interface SessionThreadPageRequest {
  sessionId: string
  limit: number
  cursor?: SessionThreadPageCursor
}

export interface SessionThreadPage extends SessionRowCommit {
  threadIds: string[]
  nextCursor: SessionThreadPageCursor | null
}

export interface SessionMessagesRequest {
  sessionId: string
  messageIds: string[]
  expectedRevision?: number
}

/** A read-only selection from one committed revision; missing ids are omitted. */
export interface SessionMessagesSnapshot extends SessionRowCommit {
  textTokens?: SessionTextTokenRead
  messages: MessageRow[]
}

export interface SessionThreadSuffixRequest {
  sessionId: string
  threadId: string
  afterSeq: number
  expectedRevision: number
}

export interface GeneratingMessageRef {
  sessionId: string
  threadId: string
  messageId: string
}

export type SessionRowStoreOperation =
  | 'initialize'
  | 'read-rows'
  | 'read-message-window'
  | 'read-thread-page'
  | 'read-messages'
  | 'read-context'
  | 'write-rows'
  | 'apply-diff'
  | 'delete-rows'
  | 'has-rows'
  | 'get-revision'
  | 'list-session-ids'
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
export interface SessionRowStorePort extends Partial<SessionTextTokenStorePort> {
  initialize(): Promise<void>
  /** Rows, record and revision from one committed snapshot; null when the session has no visible rows. */
  readStructure?(request: { sessionId: string; expectedRevision?: number }): Promise<SessionStructureSnapshot | null>
  readSnapshot(sessionId: string): Promise<SessionRowSnapshot | null>
  /** Reads only the selected path window. Stale cursors throw SessionRowConflictError; restart at the tail. */
  readMessageWindow(request: SessionMessageWindowRequest): Promise<SessionMessageWindow | null>
  /** Bounded thread identities without message or compaction payloads. */
  readThreadsPage?(request: SessionThreadPageRequest): Promise<SessionThreadPage | null>
  /** Returns rows in deduplicated request order, across active, archived and fork paths. */
  readMessages(request: SessionMessagesRequest): Promise<SessionMessagesSnapshot | null>
  /** Rows whose DFS labels must move when inserting before an inactive branch. */
  readThreadSuffix?(request: SessionThreadSuffixRequest): Promise<SessionMessagesSnapshot | null>
  /** Reuse committed payloads only when their session and revision match the selected snapshot. */
  readContext(
    request: SessionContextRequest,
    knownSnapshot?: Pick<SessionRowSnapshot, 'rows' | 'revision'>
  ): Promise<SessionContextRows | null>
  /** Replaces rows and commit metadata atomically. Callers keep the snapshot immutable until the write settles. */
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
  /** Startup repair scan; returns references only, without loading payloads. */
  findMessagesByStatus(status: MessageRowStatus): Promise<GeneratingMessageRef[]>
}
