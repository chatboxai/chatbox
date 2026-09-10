import type { SessionRepositoryPort } from '../../ports'
import type { Session, SessionMeta, SessionMetaRecord, Updater } from '../../types'
import { projectSessionMetaUpdate } from './session-metadata'

export interface SessionWriteResult {
  session: Session
  meta: SessionMeta | null
}

export interface SessionWriteOptions {
  updateMeta?: boolean
  /** Explicit restore/import paths may clear a metadata-only recovery archive. */
  clearRecoveryArchive?: boolean
}

export interface SessionWriteCoordinatorOptions {
  /**
   * The current Renderer injects a React Query-backed reader so the first
   * persisted write starts from cache-only streaming state when it exists.
   * Other hosts can inject their own read model or use repository reads.
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
    readonly metadataError: unknown
  ) {
    super(`Failed to update metadata for session ${session.id}`, { cause: metadataError })
  }
}

/**
 * Serializes read-modify-write operations per session id.
 *
 * The in-memory state is updated only after the full session write succeeds.
 * A failed operation does not poison the tail: later writes can still run.
 * After the first read or `prime`, that snapshot remains the source for later
 * updates. Runtime full-session writes must therefore go through this coordinator.
 * Restore/import code that writes the repository directly must call `forget` for
 * every affected id before another update, or recreate/reload the runtime.
 */
export class SessionWriteCoordinator {
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

  update(sessionId: string, updater: Updater<Session>, options: SessionWriteOptions = {}): Promise<SessionWriteResult> {
    if (this.unavailable.has(sessionId)) {
      return Promise.reject(new SessionNotFoundError(sessionId))
    }
    return this.enqueue(sessionId, () => this.performUpdate(sessionId, updater, options))
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

  forget(sessionId: string): void {
    this.unavailable.delete(sessionId)
    this.current.delete(sessionId)
    this.recoveryArchives.delete(sessionId)
    this.loadedRecoveryArchiveState.delete(sessionId)
  }

  private enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
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
    fallbackSnapshot?: Session
  ): Promise<SessionWriteResult> {
    const recoveryArchivedAt = options.clearRecoveryArchive ? undefined : await this.loadRecoveryArchive(sessionId)
    const previous = this.current.get(sessionId) ?? fallbackSnapshot ?? (await this.readCurrentSession(sessionId))
    if (!previous) {
      throw new SessionNotFoundError(sessionId)
    }

    const next = typeof updater === 'function' ? updater(previous) : { ...previous, ...updater }
    const updated = recoveryArchivedAt === undefined ? next : { ...next, hidden: true, archivedAt: recoveryArchivedAt }
    await this.repository.setSession(updated)
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
        throw new SessionMetadataUpdateError(updated, error)
      }
    }
    return { session: updated, meta }
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
