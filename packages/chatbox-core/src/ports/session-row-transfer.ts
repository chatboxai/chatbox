import type { MessageRow, ThreadRow } from '../session/session-tree/types'
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
  signal?: AbortSignal
}

/** A bounded writer for one invisible session candidate. */
export interface SessionRowWriter {
  appendThread(thread: ThreadRow): Promise<void>
  appendMessage(message: MessageRow): Promise<void>
  /** Publishes rows and commit metadata atomically, checking the expected target revision. */
  publish(): Promise<void>
  /** Discards unpublished rows; does not undo a successful publication. */
  dispose(): Promise<void>
}

/** Durable, hidden rows owned by one import job. */
export interface SessionRowImportWriter extends SessionRowWriter {
  readonly candidateId: string
  readonly commit: SessionRowCommit
  appendRows(rows: readonly SessionStoredRow[], onIssue?: SessionRowImportIssueHandler): Promise<void>
  /** Repairs relationships; reuses internal fork projections only while the candidate remains unchanged. */
  prepare(
    onIssue?: SessionRowImportIssueHandler,
    forks?: ReadonlyMap<string, NonNullable<MessageRow['fork']>>
  ): Promise<SessionRowImportPreparation | void>
  /** Removes candidate rows; deferred navigation cleanup requires collectImportGarbage afterward. */
  dispose(options?: { deferNavigationCleanup?: boolean }): Promise<void>
}

export interface SessionRowTransferPort {
  /** Threads precede complete messages; reads must stay at one committed revision. */
  iterateRows(request: SessionRowIterationRequest): AsyncIterable<SessionStoredRow>
  /** Stages internal rows whose topology is preserved or validated by the calling operation. */
  stageRows(commit: SessionRowCommit, expectedRevision: number | null): Promise<SessionRowWriter>
  stageImportRows?(
    commit: SessionRowCommit,
    expectedRevision: number | null,
    jobId: string
  ): Promise<SessionRowImportWriter>
  resumeImportRows?(candidateId: string): Promise<SessionRowImportWriter>
  /** Collects unreferenced navigation payloads after all import candidates have been disposed. */
  collectImportGarbage?(): Promise<void>
}
