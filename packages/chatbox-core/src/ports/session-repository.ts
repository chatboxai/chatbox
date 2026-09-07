import type { Session, SessionMetaPage, SessionMetaRecord } from '../types/session'
import type { SessionContextRepositoryPort } from './session-context-source'
import type { SessionMessageRepositoryPort } from './session-message-source'
import type { SessionReadRepositoryPort } from './session-read-model'
import type { SessionTextTokenRepositoryPort } from './session-text-tokens'

export type SessionRepositoryOperation =
  | 'initialize'
  | 'get-session'
  | 'set-session'
  | 'delete-session'
  | 'list-session-ids'
  | 'create-meta'
  | 'create-meta-many'
  | 'update-meta'
  | 'get-meta'
  | 'delete-meta'
  | 'delete-meta-many'
  | 'list-meta'
  | 'list-meta-including-hidden'
  | 'list-archived-meta'
  | 'list-archived-meta-page'
  | 'list-meta-page'
  | 'count-meta'
  | 'count-all-meta'
  | 'count-archived-meta'
  | 'clear-meta'

export class SessionRepositoryError extends Error {
  readonly name = 'SessionRepositoryError'

  constructor(
    readonly operation: SessionRepositoryOperation,
    readonly cause: unknown,
    readonly sessionId?: string
  ) {
    super(`Session repository operation failed: ${operation}${sessionId ? ` (${sessionId})` : ''}`)
  }
}

export class SessionWriteConflictError extends Error {
  readonly name = 'SessionWriteConflictError'

  constructor(
    readonly sessionId: string,
    readonly expectedRevision: number | null,
    readonly actualRevision: number | null
  ) {
    super(`Session ${sessionId} changed before the write could be committed`)
  }
}

export interface SessionDataWriteOptions {
  /**
   * The caller guarantees that, against the last persisted state, only this
   * message's content differs: the set of messages, their parent/child links,
   * the selected branches and the threads are all unchanged. Implementations
   * may use it to write less, and may ignore it.
   */
  changedMessageId?: string
  /** Snapshot the caller used to derive this write, for optimistic concurrency control. */
  baseSession?: Session
}

export interface SessionDataRepositoryPort
  extends Partial<SessionReadRepositoryPort>,
    Partial<SessionContextRepositoryPort>,
    Partial<SessionTextTokenRepositoryPort>,
    Partial<SessionMessageRepositoryPort> {
  initialize(): Promise<void>
  getSession(id: string): Promise<Session | null>
  setSession(session: Session, options?: SessionDataWriteOptions): Promise<void>
  deleteSession(id: string): Promise<void>
  getAllSessionIds(): Promise<string[]>
}

export interface SessionMetaRepositoryPort {
  initialize(): Promise<void>
  create(record: SessionMetaRecord): Promise<void>
  createMany(records: SessionMetaRecord[]): Promise<void>
  update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null>
  getById(id: string): Promise<SessionMetaRecord | null>
  delete(id: string): Promise<void>
  deleteMany(ids: string[]): Promise<void>
  getAll(): Promise<SessionMetaRecord[]>
  getAllIncludingHidden(): Promise<SessionMetaRecord[]>
  getArchived(): Promise<SessionMetaRecord[]>
  getArchivedPage(cursor: number, limit?: number): Promise<SessionMetaPage>
  getPage(cursor: number, limit?: number): Promise<SessionMetaPage>
  getTotal(): Promise<number>
  getAllTotal(): Promise<number>
  getArchivedTotal(): Promise<number>
  clear(): Promise<void>
}

export interface SessionRepositoryPort extends SessionDataRepositoryPort {
  meta: SessionMetaRepositoryPort
}
