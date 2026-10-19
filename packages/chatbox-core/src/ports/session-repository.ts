import type { SessionRowRepositoryPort } from './session-row-repository'
import type { SessionStructureOperation, SessionStructureResult } from './session-structure-command'
import type { SessionRowCommit, SessionRowsDiff } from './session-row-store'
import type { Message, SessionFolder, SessionMetaPage, SessionMetaRecord } from '../types/session'
import type { Updater } from '../types'
import type { SessionHeader } from './session-read-model'

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

export type SessionCommand =
  | { type: 'structure'; operation: SessionStructureOperation }
  | { type: 'append'; messages: readonly Message[] }
  | { type: 'update'; messageId: string; updater: Updater<Message> }
  | { type: 'header'; updater: Updater<SessionHeader> }

/** Durable row changes and their independent header projection. */
export interface SessionCommandDelta extends SessionRowCommit {
  structureResult?: SessionStructureResult
  sessionId: string
  previousRevision: number | null
  header: SessionHeader
  previousHeader?: SessionHeader
  /** The row commit succeeded; only the external record projection needs repair. */
  recordProjectionError?: unknown
  diff: SessionRowsDiff
  /** The newly appended active-path rows, excluding the previous tail link update. */
  appendedMessageIds: string[]
}

export type SessionCommandResult = { kind: 'rows'; delta: SessionCommandDelta }

export interface SessionDataRepositoryPort extends SessionRowRepositoryPort {}

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
  /**
   * Visible sessions in display order (see `sortSessionRecords`): pinned, then
   * each folder of `folderIds` in order, then unfiled.
   */
  getPage(cursor: number, limit?: number, folderIds?: readonly string[]): Promise<SessionMetaPage>
  getTotal(): Promise<number>
  getAllTotal(): Promise<number>
  getArchivedTotal(): Promise<number>
  clear(): Promise<void>
}

/** Folder definitions of the session list; array order is display order. */
export interface SessionFolderStorePort {
  load(): Promise<SessionFolder[]>
  save(folders: SessionFolder[]): Promise<void>
}

export interface SessionRepositoryPort extends SessionDataRepositoryPort {
  meta: SessionMetaRepositoryPort
}
