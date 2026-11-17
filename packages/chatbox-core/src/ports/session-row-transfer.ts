import type { MessageRow, SessionRecordV2, ThreadRow } from '../session/session-tree/types'
import type { SessionRowCommit } from './session-row-store'

export type SessionStoredRow = { kind: 'thread'; thread: ThreadRow } | { kind: 'message'; message: MessageRow }

export interface SessionRowImportIssue {
  action: 'skipped' | 'repaired'
  entity: 'session' | 'thread' | 'message'
  id: string
  reason: string
}

export type SessionRowImportIssueHandler = (issue: SessionRowImportIssue) => void

export interface SessionRowImportPreparation {
  /** Rows remaining in the candidate; skipped-row callbacks count discarded input rows separately. */
  messageCount: number
  threadCount: number
  /** Replacing an existing session with a candidate whose messages were all unusable is unsafe. */
  skipSession: boolean
}

export function sessionImportCandidateId(jobId: string, sessionId: string): string {
  return `import:${JSON.stringify([jobId, sessionId])}`
}

export interface SessionRowIterationRequest {
  sessionId: string
  threadId?: string
  expectedRevision?: number
  /** Export reads assume the caller keeps the source idle; revision reads detect changes between pages. */
  consistency?: 'revision' | 'export'
  signal?: AbortSignal
}

/** A bounded writer for one invisible session candidate. */
export interface SessionRowWriter {
  appendThread(thread: ThreadRow): Promise<void>
  appendMessage(message: MessageRow): Promise<void>
  /** Publishes rows and commit metadata atomically. */
  publish(): Promise<void>
  /** Discards unpublished rows; does not undo a successful publication. */
  dispose(): Promise<void>
}

/** Hidden candidate rows with one in-memory lifecycle owner. */
export interface SessionRowImportWriter extends SessionRowWriter {
  readonly candidateId: string
  readonly record: SessionRecordV2
  appendRows(rows: readonly SessionStoredRow[], onIssue?: SessionRowImportIssueHandler): Promise<void>
  /** Repairs relationships; reuses internal fork projections only while the candidate remains unchanged. */
  prepare(
    onIssue?: SessionRowImportIssueHandler,
    forks?: ReadonlyMap<string, NonNullable<MessageRow['fork']>>
  ): Promise<SessionRowImportPreparation | void>
}

export interface SessionRowTransferPort {
  /** Reads the published export header once, assuming the caller keeps the source idle. */
  readExportCommit(sessionId: string): Promise<SessionRowCommit | null>
  /** Threads precede complete messages. Revision consistency is the default. */
  iterateRows(request: SessionRowIterationRequest): AsyncIterable<SessionStoredRow>
  /** Stages internal rows and checks the expected revision when publishing. */
  stageRows(commit: SessionRowCommit, expectedRevision: number | null): Promise<SessionRowWriter>
  /** Replaces a session atomically, allocating its next revision during publication. */
  stageImportRows?(record: SessionRecordV2, jobId: string): Promise<SessionRowImportWriter>
  /** Removes candidate data directly, including candidates abandoned by a stopped import. */
  disposeImportRows?(candidateId: string): Promise<void>
}
