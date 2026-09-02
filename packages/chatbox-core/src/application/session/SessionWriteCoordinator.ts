import type { SessionRepositoryPort } from '../../ports'
import type { Session, SessionMeta, Updater } from '../../types'
import { projectSessionMeta } from './session-metadata'

export interface SessionWriteResult {
  session: Session
  meta: SessionMeta | null
}

export interface SessionWriteOptions {
  updateMeta?: boolean
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
        this.discardCurrentSession(sessionId)
        this.unavailable.delete(sessionId)
      }
      throw error
    })
  }

  prime(session: Session): void {
    this.unavailable.delete(session.id)
    this.current.set(session.id, session)
  }

  forget(sessionId: string): void {
    this.unavailable.delete(sessionId)
    this.current.delete(sessionId)
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
    const previous = this.current.get(sessionId) ?? fallbackSnapshot ?? (await this.readCurrentSession(sessionId))
    if (!previous) {
      throw new SessionNotFoundError(sessionId)
    }

    const updated = typeof updater === 'function' ? updater(previous) : { ...previous, ...updater }
    await this.repository.setSession(updated)
    this.current.set(sessionId, updated)

    const meta = options.updateMeta === false ? null : projectSessionMeta(updated)
    if (meta) {
      try {
        await this.repository.meta.update(sessionId, meta)
      } catch (error) {
        throw new SessionMetadataUpdateError(updated, error)
      }
    }
    return { session: updated, meta }
  }
}
