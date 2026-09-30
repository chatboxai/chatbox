import type { SessionCommand, SessionCommandDelta } from '../../ports/session-repository'
import { type SessionRepositoryPort, SessionWriteConflictError } from '../../ports'
import { BackupOperationBusyError } from '../../backup/operation'
import type { SessionMessageDerivedWriteResult } from '../../ports/session-message-source'
import type { SessionTextTokenResult, SessionTextTokenWriteResult } from '../../ports/session-text-tokens'
import type { Session, SessionMeta, SessionMetaRecord, Updater } from '../../types'
import type { SessionMessageDerivedPatch } from './message-derived-data'
import { applySessionDerivedPatches } from './session-derived-data'
import { projectSessionMetaUpdate } from './session-metadata'
import { clearChangedTextTokenSeeds, textTokenPatches } from './session-text-tokens'
import {
  applySessionMessageMutation,
  prepareSessionMessageOperation,
  type SessionMessageOperation,
} from './message-mutation'

export interface SessionWriteResult {
  session: Session
  meta: SessionMeta | null
  /** The session the update was applied to. */
  previous?: Session
}

export interface SessionCommandWriteResult {
  kind: 'rows'
  delta: SessionCommandDelta
  meta: SessionMeta | null
}

export class SessionCommandMetadataUpdateError extends Error {
  constructor(
    readonly result: SessionCommandWriteResult,
    readonly metadataError: unknown
  ) {
    super(`Failed to update metadata for session ${result.delta.sessionId}`, { cause: metadataError })
  }
}

export interface SessionWriteOptions {
  updateMeta?: boolean
  /** Explicit restore/import paths may clear a metadata-only recovery archive. */
  clearRecoveryArchive?: boolean
  /**
   * Passed to the repository: the updater changes only this message's content,
   * leaving the message set, the branch selection and the threads alone.
   */
  changedMessageId?: string
}

export interface SessionWriteCoordinatorOptions {
  /**
   * Read a persistence-compatible baseline when no committed snapshot is held.
   * Row repositories require this snapshot to match their durable content;
   * cache-only streaming projections are display state, not a write baseline.
   */
  readCurrentSession?: (sessionId: string) => Promise<Session | null>
  /**
   * Evicts the external read model after a deletion fails. This must be
   * synchronous so stale state cannot be read between eviction and reopening
   * writes for the affected session.
   */
  discardCurrentSession?: (sessionId: string) => void
}

export class SessionNotFoundError extends Error {
  readonly name = 'SessionNotFoundError'

  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} not found`)
  }
}

/**
 * Internal partial-success signal: full session data was persisted, but its
 * denormalized metadata projection was not. SessionService uses this to keep
 * external read models aligned before rethrowing the original metadata error.
 */
export class SessionMetadataUpdateError extends Error {
  readonly name = 'SessionMetadataUpdateError'

  constructor(
    readonly session: Session,
    /** The projection that failed to persist, so callers can still align live read models. */
    readonly meta: SessionMeta,
    readonly metadataError: unknown
  ) {
    super(`Failed to update metadata for session ${session.id}`, { cause: metadataError })
  }
}

/**
 * Serializes read-modify-write operations per session id.
 *
 * Full-session operations retain the last committed snapshot. Row commands use
 * the repository revision and discard that snapshot after committing their delta.
 * A failed operation does not poison the tail: later writes can still run.
 * Runtime writes must go through this coordinator to preserve both ownership paths.
 * Restore/import code that writes the repository directly must call `forget` for
 * every affected id before another update, or recreate/reload the runtime.
 */
export interface SessionBackupWriteAccess {
  replaceSession(session: Session): Promise<void>
  removeSession(sessionId: string): Promise<void>
}

export class SessionWriteCoordinator {
  private backupProtected = false
  private readonly current = new Map<string, Session>()
  private readonly tails = new Map<string, Promise<void>>()
  private readonly unavailable = new Set<string>()
  private readonly recoveryArchives = new Map<string, number>()
  private readonly loadedRecoveryArchiveState = new Set<string>()
  private readonly readCurrentSession: (sessionId: string) => Promise<Session | null>
  private readonly discardCurrentSession: (sessionId: string) => void

  constructor(
    private readonly repository: SessionRepositoryPort,
    options: SessionWriteCoordinatorOptions = {}
  ) {
    this.readCurrentSession = options.readCurrentSession ?? ((sessionId) => this.repository.getSession(sessionId))
    this.discardCurrentSession = options.discardCurrentSession ?? (() => undefined)
  }

  create<T>(session: Session, persist: () => Promise<T>): Promise<T> {
    return this.enqueue(session.id, async () => {
      const result = await persist()
      this.prime(session)
      return result
    })
  }

  updateSortOrder(sessionId: string, sortOrder: number): Promise<SessionMetaRecord | null> {
    return this.enqueue(sessionId, () => this.repository.meta.update(sessionId, { sortOrder }))
  }

  update(sessionId: string, updater: Updater<Session>, options: SessionWriteOptions = {}): Promise<SessionWriteResult> {
    if (this.unavailable.has(sessionId)) {
      return Promise.reject(new SessionNotFoundError(sessionId))
    }
    return this.enqueue(sessionId, () => this.performUpdate(sessionId, updater, options))
  }

  executeCommand(
    sessionId: string,
    command: SessionCommand
  ): Promise<SessionCommandWriteResult | ({ kind: 'full' } & SessionWriteResult) | null> {
    if (this.unavailable.has(sessionId)) return Promise.reject(new SessionNotFoundError(sessionId))
    return this.enqueue(sessionId, async () => {
      if (!this.repository.executeSessionCommand || (await this.loadRecoveryArchive(sessionId)) !== undefined)
        return null
      const committed = await this.repository.executeSessionCommand(sessionId, command).catch((error: unknown) => {
        if (error instanceof SessionWriteConflictError) {
          this.current.delete(sessionId)
          this.discardCurrentSession(sessionId)
        }
        throw error
      })
      if (committed.kind === 'full') {
        this.current.set(sessionId, committed.session)
        const meta = projectSessionMetaUpdate(committed.session)
        try {
          await this.repository.meta.update(sessionId, meta)
        } catch (error) {
          throw new SessionMetadataUpdateError(committed.session, meta, error)
        }
        return { ...committed, meta }
      }
      this.current.delete(sessionId)
      const { delta } = committed
      const projected = projectSessionMetaUpdate(
        { ...delta.header, messages: [] },
        (delta.record.presentation?.pausedMessageCount ?? 0) > 0
      )
      const result: SessionCommandWriteResult = { kind: 'rows', delta, meta: projected }
      try {
        await this.repository.meta.update(sessionId, projected)
      } catch (error) {
        throw new SessionCommandMetadataUpdateError(result, error)
      }
      return result
    })
  }

  mutateMessages(
    sessionId: string,
    operation: SessionMessageOperation,
    options: SessionWriteOptions = {}
  ): Promise<SessionWriteResult> {
    if (this.unavailable.has(sessionId)) return Promise.reject(new SessionNotFoundError(sessionId))
    return this.enqueue(sessionId, () => this.performUpdate(sessionId, {}, options, undefined, operation))
  }

  patchMessageDerivedData(
    sessionId: string,
    patches: SessionMessageDerivedPatch[]
  ): Promise<SessionMessageDerivedWriteResult> {
    if (this.unavailable.has(sessionId)) return Promise.reject(new SessionNotFoundError(sessionId))
    return this.enqueue(sessionId, async () => {
      if (!this.repository.patchSessionMessageDerivedData) {
        let accepted: SessionMessageDerivedPatch[] = []
        await this.performUpdate(
          sessionId,
          (session) => {
            if (!session) throw new SessionNotFoundError(sessionId)
            const result = applySessionDerivedPatches(session, patches)
            accepted = result.patches
            return result.session
          },
          { updateMeta: false }
        )
        return { sessionId, previousRevision: null, revision: null, patches: accepted }
      }
      try {
        const result = await this.repository.patchSessionMessageDerivedData(sessionId, patches)
        const current = this.current.get(sessionId)
        if (current && result.patches.length) {
          this.current.set(sessionId, applySessionDerivedPatches(current, result.patches).session)
        }
        return result
      } catch (error) {
        if (error instanceof SessionWriteConflictError || error instanceof SessionNotFoundError) {
          this.current.delete(sessionId)
          this.discardCurrentSession(sessionId)
        }
        throw error
      }
    })
  }

  acceptTextTokenResults(
    sessionId: string,
    results: readonly SessionTextTokenResult[]
  ): Promise<SessionTextTokenWriteResult> {
    if (this.unavailable.has(sessionId)) return Promise.resolve({ sessionId, results: [] })
    return this.enqueue(sessionId, async () => {
      if (!this.repository.acceptSessionTextTokenResults)
        throw new Error('Source-bound text token results are unavailable')
      const result = await this.repository.acceptSessionTextTokenResults(sessionId, results)
      const current = this.current.get(sessionId)
      if (current)
        this.current.set(sessionId, applySessionDerivedPatches(current, textTokenPatches(result.results)).session)
      return result
    })
  }

  /**
   * Serialize a repair derived from a repository read without re-reading through
   * an external cache that may currently be resolving that same request.
   */
  updateFromSnapshot(
    snapshot: Session,
    updater: Updater<Session>,
    options: SessionWriteOptions = {}
  ): Promise<SessionWriteResult> {
    if (this.unavailable.has(snapshot.id)) {
      return Promise.reject(new SessionNotFoundError(snapshot.id))
    }
    return this.enqueue(snapshot.id, () => this.performUpdate(snapshot.id, updater, options, snapshot))
  }

  /**
   * Re-derives and persists the metadata projection from the retained snapshot,
   * serialized behind already queued writes. Repairs a failed projection write
   * after the full session itself was persisted; returns null when there is no
   * snapshot to project (session deleted, fenced, or never written here).
   */
  reprojectMeta(sessionId: string): Promise<SessionWriteResult | null> {
    if (this.unavailable.has(sessionId)) {
      return Promise.resolve(null)
    }
    return this.enqueue(sessionId, async () => {
      if (this.unavailable.has(sessionId)) return null
      const current = this.current.get(sessionId)
      if (!current) return null
      const recoveryArchivedAt = await this.loadRecoveryArchive(sessionId)
      const meta = this.projectMeta(current, recoveryArchivedAt)
      await this.repository.meta.update(sessionId, meta)
      return { session: current, meta }
    })
  }

  /**
   * Serializes a recovery archive behind pending full-session writes without
   * reading the potentially corrupt session. The next successful full write
   * converts it to an ordinary durable archive before clearing the marker.
   */
  archiveMetadataOnly(sessionId: string, archivedAt: number): Promise<SessionMetaRecord | null> {
    if (this.unavailable.has(sessionId)) {
      return Promise.reject(new SessionNotFoundError(sessionId))
    }
    return this.enqueue(sessionId, async () => {
      const updated = await this.repository.meta.update(sessionId, {
        hidden: true,
        archivedAt,
        recoveryArchived: true,
      })
      if (updated) {
        this.recoveryArchives.set(sessionId, archivedAt)
        this.loadedRecoveryArchiveState.add(sessionId)
      }
      return updated
    })
  }

  /** Restores a metadata-only recovery archive without reading the full session. */
  restoreMetadataOnly(sessionId: string): Promise<SessionMetaRecord | null> {
    if (this.unavailable.has(sessionId)) {
      return Promise.reject(new SessionNotFoundError(sessionId))
    }
    return this.enqueue(sessionId, async () => {
      const existing = await this.repository.meta.getById(sessionId)
      if (!existing) return null
      if (
        (!existing.recoveryArchived && existing.archivedAt !== undefined) ||
        this.current.get(sessionId)?.archivedAt !== undefined
      ) {
        await this.performUpdate(sessionId, { hidden: false, archivedAt: undefined }, { clearRecoveryArchive: true })
        return this.repository.meta.getById(sessionId)
      }
      const updated = await this.repository.meta.update(sessionId, {
        hidden: false,
        archivedAt: undefined,
        recoveryArchived: undefined,
      })
      if (updated) {
        this.recoveryArchives.delete(sessionId)
        this.loadedRecoveryArchiveState.add(sessionId)
      }
      return updated
    })
  }

  delete(sessionId: string, operation: () => Promise<void>): Promise<void> {
    return this.deleteMany([sessionId], operation)
  }

  /**
   * Fence new writes immediately, drain writes already queued for every id, then
   * run deletion once. Successful deletions stay fenced so stale caches cannot
   * recreate the session after storage removal.
   */
  deleteMany(sessionIds: string[], operation: () => Promise<void>): Promise<void> {
    if (this.backupProtected) return Promise.reject(new BackupOperationBusyError())
    const uniqueIds = [...new Set(sessionIds)]
    for (const sessionId of uniqueIds) {
      this.unavailable.add(sessionId)
    }

    const previousTails = uniqueIds.map((sessionId) => this.tails.get(sessionId)?.catch(() => undefined))
    const deletion = Promise.all(previousTails).then(async () => {
      await operation()
      for (const sessionId of uniqueIds) {
        this.current.delete(sessionId)
        this.recoveryArchives.delete(sessionId)
        this.loadedRecoveryArchiveState.delete(sessionId)
      }
    })
    const nextTail = deletion.then(
      () => undefined,
      () => undefined
    )
    for (const sessionId of uniqueIds) {
      this.tails.set(sessionId, nextTail)
    }
    void nextTail.then(() => {
      for (const sessionId of uniqueIds) {
        if (this.tails.get(sessionId) === nextTail) {
          this.tails.delete(sessionId)
        }
      }
    })

    return deletion.catch((error: unknown) => {
      for (const sessionId of uniqueIds) {
        // Deletion may have already removed some repository entries before a
        // later step failed. Drop every cached snapshot before reopening writes
        // so a surviving id is re-read and a removed id cannot be resurrected.
        this.current.delete(sessionId)
        this.recoveryArchives.delete(sessionId)
        this.loadedRecoveryArchiveState.delete(sessionId)
        this.discardCurrentSession(sessionId)
        this.unavailable.delete(sessionId)
      }
      throw error
    })
  }

  prime(session: Session): void {
    this.unavailable.delete(session.id)
    this.current.set(session.id, session)
    this.recoveryArchives.delete(session.id)
    this.loadedRecoveryArchiveState.add(session.id)
  }

  /** Explicit backup restoration replaces a record, including a missing or deleted id, after queued writes drain. */
  replaceFromBackup(session: Session): Promise<void> {
    return this.enqueue(session.id, () => this.replaceBackupSession(session))
  }

  private async replaceBackupSession(session: Session): Promise<void> {
    const baseSession = await this.repository.getSession(session.id)
    try {
      await this.repository.setSession(session, { baseSession: baseSession ?? undefined })
    } finally {
      // Storage can repair a restored session's shape, so the next update reads what was stored.
      this.forget(session.id)
      this.discardCurrentSession(session.id)
    }
  }

  forget(sessionId: string): void {
    this.unavailable.delete(sessionId)
    this.current.delete(sessionId)
    this.recoveryArchives.delete(sessionId)
    this.loadedRecoveryArchiveState.delete(sessionId)
  }

  /** Fences new writes for the full backup operation, including rollback and cleanup. */
  async withBackupAccess<T>(action: (access: SessionBackupWriteAccess) => Promise<T>): Promise<T> {
    if (this.backupProtected) throw new BackupOperationBusyError()
    this.backupProtected = true
    let active = true
    const pending = new Set<Promise<void>>()
    const failures = new Set<unknown>()
    const run = (write: () => Promise<void>): Promise<void> => {
      if (!active) return Promise.reject(new Error('Backup write access has expired'))
      const result = Promise.resolve().then(write)
      const tail = result
        .then(
          () => {},
          (error: unknown) => {
            failures.add(error)
          }
        )
        .finally(() => {
          pending.delete(tail)
        })
      pending.add(tail)
      return result
    }
    let value: T | undefined
    try {
      await Promise.all(this.tails.values())
      value = await action({
        replaceSession: (session) => run(() => this.replaceBackupSession(session)),
        removeSession: (sessionId) =>
          run(async () => {
            try {
              await this.repository.deleteSession(sessionId)
            } finally {
              this.forget(sessionId)
              this.discardCurrentSession(sessionId)
            }
          }),
      })
    } catch (error) {
      failures.add(error)
    } finally {
      active = false
      await Promise.all(pending)
      this.backupProtected = false
    }
    if (failures.size === 1) throw failures.values().next().value
    if (failures.size > 1) throw new AggregateError([...failures], 'Backup writes failed')
    return value as T
  }

  private enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    if (this.backupProtected) return Promise.reject(new BackupOperationBusyError())
    const previousTail = this.tails.get(sessionId) ?? Promise.resolve()
    const result = previousTail.catch(() => undefined).then(operation)
    const nextTail = result.then(
      () => undefined,
      () => undefined
    )
    this.tails.set(sessionId, nextTail)
    void nextTail.then(() => {
      if (this.tails.get(sessionId) === nextTail) {
        this.tails.delete(sessionId)
      }
    })
    return result
  }

  private async performUpdate(
    sessionId: string,
    updater: Updater<Session>,
    options: SessionWriteOptions,
    fallbackSnapshot?: Session,
    operation?: SessionMessageOperation
  ): Promise<SessionWriteResult> {
    const recoveryArchivedAt = options.clearRecoveryArchive ? undefined : await this.loadRecoveryArchive(sessionId)
    const previous = this.current.get(sessionId) ?? fallbackSnapshot ?? (await this.readCurrentSession(sessionId))
    if (!previous) {
      throw new SessionNotFoundError(sessionId)
    }

    const mutation = operation
      ? prepareSessionMessageOperation(previous, operation, Boolean(this.repository.acceptSessionTextTokenResults))
      : undefined
    const next = operation
      ? mutation
        ? applySessionMessageMutation(previous, mutation)
        : previous
      : typeof updater === 'function'
        ? updater(previous)
        : { ...previous, ...updater }
    const content =
      !operation && this.repository.acceptSessionTextTokenResults ? clearChangedTextTokenSeeds(next, previous) : next
    let updated =
      recoveryArchivedAt === undefined ? content : { ...content, hidden: true, archivedAt: recoveryArchivedAt }
    try {
      await this.repository.setSession(updated, { changedMessageId: options.changedMessageId, baseSession: previous })
    } catch (error) {
      if (error instanceof SessionWriteConflictError) {
        this.current.delete(sessionId)
        this.discardCurrentSession(sessionId)
      }
      throw error
    }
    this.current.set(sessionId, updated)

    if (recoveryArchivedAt !== undefined || options.clearRecoveryArchive) {
      this.recoveryArchives.delete(sessionId)
      this.loadedRecoveryArchiveState.add(sessionId)
    }

    const meta = options.updateMeta === false ? null : projectSessionMetaUpdate(updated)
    if (meta) {
      try {
        await this.repository.meta.update(sessionId, meta)
      } catch (error) {
        throw new SessionMetadataUpdateError(updated, meta, error)
      }
    }
    return { session: updated, meta, previous }
  }

  private async loadRecoveryArchive(sessionId: string): Promise<number | undefined> {
    if (!this.loadedRecoveryArchiveState.has(sessionId)) {
      const meta = await this.repository.meta.getById(sessionId)
      if (meta?.recoveryArchived && meta.archivedAt !== undefined) {
        this.recoveryArchives.set(sessionId, meta.archivedAt)
      }
      this.loadedRecoveryArchiveState.add(sessionId)
    }
    return this.recoveryArchives.get(sessionId)
  }

  private projectMeta(session: Session, recoveryArchivedAt?: number): SessionMeta {
    const meta = projectSessionMetaUpdate(session)
    return recoveryArchivedAt === undefined
      ? meta
      : { ...meta, hidden: true, archivedAt: recoveryArchivedAt, recoveryArchived: true }
  }
}
