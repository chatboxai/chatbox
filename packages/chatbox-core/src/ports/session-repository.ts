import type { Session, SessionMetaPage, SessionMetaRecord } from '../types/session'

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

export interface SessionDataRepositoryPort {
  initialize(): Promise<void>
  getSession(id: string): Promise<Session | null>
  setSession(session: Session): Promise<void>
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
