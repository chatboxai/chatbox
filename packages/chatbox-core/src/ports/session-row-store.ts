import type { SessionTokenCacheStorePort } from './session-token-cache'
import type { SessionBranchStorePort } from './session-branch-source'
import type { SessionRowRangeMutations, SessionRowRelationsPort } from './session-row-relations'
import type { SessionTranscriptStorePort } from './session-transcript-source'
import type {
  MessageRow,
  MessageRowMetadata,
  MessageRowStatus,
  SessionRecordV2,
  ThreadRow,
} from '../session/session-tree/types'
import type { SessionTextTokenRead, SessionTextTokenStorePort } from './session-text-tokens'

export interface SessionRows {
  sessionId: string
  threads: ThreadRow[]
  messages: MessageRow[]
}

export interface SessionRowsDiff extends SessionRowRangeMutations {
  /** Structural edits retain the committed payload and require an expected revision. */
  messageMetadataUpsert?: MessageRowMetadata[]
  sessionId: string
  threads: { upsert: ThreadRow[]; delete: string[] }
  messages: { upsert: MessageRow[]; delete: string[] }
}

/** Metadata committed atomically with one visible row mutation. */
export interface SessionRowCommit {
  record: SessionRecordV2
  revision: number
}

/** Projections produced by the same successful row publication. */
export interface SessionRowMutationResult extends SessionRowCommit {
  threads: ThreadRow[]
  /** Final explicit point writes and derived fork pivots; selected-path range changes remain scoped by the diff. */
  messageMetadata: MessageRowMetadata[]
}

/** One complete, internally consistent row-store snapshot. */
export interface SessionRowSnapshot extends SessionRowCommit {
  rows: SessionRows
  textTokens?: SessionTextTokenRead
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

export interface GeneratingMessageRef {
  sessionId: string
  threadId: string
  messageId: string
}

export type SessionRowStoreOperation =
  | 'read-message-metadata'
  | 'read-message-relations'
  | 'initialize'
  | 'read-rows'
  | 'read-commit'
  | 'read-thread'
  | 'read-transcript'
  | 'read-navigation'
  | 'read-thread-page'
  | 'read-messages'
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
export interface SessionRowStorePort
  extends SessionBranchStorePort,
    SessionTranscriptStorePort,
    SessionRowRelationsPort,
    SessionTokenCacheStorePort,
    Partial<SessionTextTokenStorePort> {
  initialize(): Promise<void>
  readSnapshot(sessionId: string): Promise<SessionRowSnapshot | null>
  /** Bounded thread identities without message or compaction payloads. */
  readThreadsPage?(request: SessionThreadPageRequest): Promise<SessionThreadPage | null>
  /** Returns rows in deduplicated request order, across active, archived and fork paths. */
  readMessages(request: SessionMessagesRequest): Promise<SessionMessagesSnapshot | null>
  /** Replaces rows and commit metadata atomically. Callers keep the snapshot immutable until the write settles. */
  writeRows(snapshot: SessionRowSnapshot, expectedRevision?: number | null): Promise<void>
  /** Applies a diff and publishes its commit metadata atomically. */
  applyDiff(
    diff: SessionRowsDiff,
    commit: SessionRowCommit,
    expectedRevision?: number
  ): Promise<SessionRowMutationResult>
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
