import type { SessionCopyRequest, SessionThreadCopyRequest } from '../../ports/session-row-repository'
import { BackupOperationBusyError } from '../../backup/operation'
import type { SessionHeaderRead, SessionRepositoryPort } from '../../ports'
import type { SessionCommand, SessionCommandDelta } from '../../ports/session-repository'
import type { SessionMessageDerivedWriteResult } from '../../ports/session-message-source'
import type { SessionTextTokenResult, SessionTextTokenWriteResult } from '../../ports/session-text-tokens'
import type { Message, SessionHeader, SessionMeta, SessionMetaRecord } from '../../types'
import type { SessionMessageDerivedPatch } from './message-derived-data'
import { createSessionMetaRecord, projectSessionMetaUpdate } from './session-metadata'

export interface SessionMetaProjection {
  meta: SessionMetaRecord | null
  metaRevision: number | null
}

export interface SessionCommandWriteResult extends SessionMetaProjection {
  kind: 'rows'
  delta: SessionCommandDelta
  projectionError?: unknown
}

export interface SessionCommandWriteOptions {
  expectedRevision?: number
  onPersisted?: (header: SessionHeader) => void
  clearRecoveryArchive?: boolean
}

export class SessionNotFoundError extends Error {
  readonly name = 'SessionNotFoundError'
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} not found`)
  }
}

/** Application-operation fences; the repository owns the storage transaction queue. */
export class SessionWriteCoordinator {
  private backupProtected = false
  private readonly tails = new Map<string, Promise<void>>()
  private readonly unavailable = new Set<string>()
  private readonly pendingRecoveryClear = new Set<string>()
  private readonly creationOrder = new Map<string, { sortOrder: number; createdAt: number }>()

  constructor(private readonly repository: SessionRepositoryPort) {}

  create(
    header: SessionHeader,
    messages: readonly Message[],
    sortOrder: number,
    createdAt: number
  ): Promise<SessionCommandWriteResult> {
    return this.enqueue(
      header.id,
      async () => {
        const delta = await this.repository.createSessionRows(header, messages)
        this.unavailable.delete(header.id)
        this.creationOrder.set(header.id, { sortOrder, createdAt })
        return this.projectCommit(delta)
      },
      true
    )
  }

  copyThread(request: SessionThreadCopyRequest, sortOrder: number): Promise<SessionCommandWriteResult> {
    const { threadId, ...source } = request
    return this.copy({ ...source, scope: { type: 'thread', threadId } }, sortOrder)
  }

  copy(request: SessionCopyRequest, sortOrder: number): Promise<SessionCommandWriteResult> {
    return this.enqueue(
      request.targetSessionId,
      async () => {
        const delta = await this.repository.copySessionRows(request)
        this.unavailable.delete(request.targetSessionId)
        this.creationOrder.set(request.targetSessionId, { sortOrder, createdAt: request.createdAt })
        return this.projectCommit(delta)
      },
      true
    )
  }

  executeCommand(
    sessionId: string,
    command: SessionCommand,
    options: SessionCommandWriteOptions = {}
  ): Promise<SessionCommandWriteResult> {
    return this.enqueue(sessionId, async () => {
      const { delta } = await this.repository.executeSessionCommand(sessionId, command, options.expectedRevision)
      if (options.clearRecoveryArchive) this.pendingRecoveryClear.add(sessionId)
      return this.projectCommit(delta, options.clearRecoveryArchive)
    })
  }

  private async projectCommit(
    delta: SessionCommandDelta,
    clearRecoveryArchive = false
  ): Promise<SessionCommandWriteResult> {
    try {
      const projected = await this.projectMeta(delta.sessionId, clearRecoveryArchive)
      return { kind: 'rows', delta, ...projected }
    } catch (projectionError) {
      return { kind: 'rows', delta, meta: null, metaRevision: null, projectionError }
    }
  }

  private projectMeta(sessionId: string, clearRecoveryArchive = false): Promise<SessionMetaProjection> {
    return this.repository.projectLatestSession(sessionId, async (read) => {
      if (!read) return { meta: null, metaRevision: null }
      const current = await this.repository.meta.getById(sessionId)
      const meta = this.metadata(read, current, clearRecoveryArchive || this.pendingRecoveryClear.has(sessionId))
      let updated: SessionMetaRecord | null
      if (current) updated = await this.repository.meta.update(sessionId, meta)
      else {
        const order = this.creationOrder.get(sessionId) ?? { sortOrder: Date.now(), createdAt: Date.now() }
        updated = {
          ...createSessionMetaRecord(
            read.header,
            order.sortOrder,
            order.createdAt,
            read.summary.pausedMessageCount > 0
          ),
          ...meta,
        }
        await this.repository.meta.create(updated)
      }
      this.creationOrder.delete(sessionId)
      this.pendingRecoveryClear.delete(sessionId)
      return { meta: updated, metaRevision: read.revision }
    })
  }

  private metadata(
    read: SessionHeaderRead,
    current: SessionMetaRecord | null,
    clearRecoveryArchive: boolean
  ): SessionMeta {
    const meta = projectSessionMetaUpdate(read.header, read.summary.pausedMessageCount > 0)
    return current?.recoveryArchived && !clearRecoveryArchive
      ? { ...meta, hidden: true, archivedAt: current.archivedAt, recoveryArchived: true }
      : meta
  }

  reprojectMeta(sessionId: string): Promise<SessionMetaProjection | null> {
    if (this.unavailable.has(sessionId)) return Promise.resolve(null)
    return this.enqueue(sessionId, () => this.projectMeta(sessionId))
  }

  updateSortOrder(sessionId: string, sortOrder: number): Promise<SessionMetaRecord | null> {
    return this.enqueue(sessionId, () =>
      this.repository.projectSessionMetadata(sessionId, () => this.repository.meta.update(sessionId, { sortOrder }))
    )
  }

  archiveMetadataOnly(sessionId: string, archivedAt: number): Promise<SessionMetaRecord | null> {
    return this.enqueue(sessionId, () =>
      this.repository.projectSessionMetadata(sessionId, () =>
        this.repository.meta.update(sessionId, { hidden: true, archivedAt, recoveryArchived: true })
      )
    )
  }

  restoreMetadataOnly(sessionId: string): Promise<SessionMetaRecord | null> {
    return this.enqueue(sessionId, () =>
      this.repository.projectSessionMetadata(sessionId, () =>
        this.repository.meta.update(sessionId, { hidden: false, archivedAt: undefined, recoveryArchived: undefined })
      )
    )
  }

  patchMessageDerivedData(
    sessionId: string,
    patches: SessionMessageDerivedPatch[]
  ): Promise<SessionMessageDerivedWriteResult> {
    return this.enqueue(sessionId, () => this.repository.patchSessionMessageDerivedData(sessionId, patches))
  }

  acceptTextTokenResults(
    sessionId: string,
    results: readonly SessionTextTokenResult[]
  ): Promise<SessionTextTokenWriteResult> {
    if (this.unavailable.has(sessionId)) return Promise.resolve({ sessionId, results: [] })
    return this.enqueue(sessionId, () => this.repository.acceptSessionTextTokenResults(sessionId, results))
  }

  delete(sessionId: string, operation: () => Promise<void>): Promise<void> {
    return this.deleteMany([sessionId], operation)
  }

  deleteMany(sessionIds: string[], operation: () => Promise<void>): Promise<void> {
    if (this.backupProtected) return Promise.reject(new BackupOperationBusyError())
    const ids = [...new Set(sessionIds)]
    for (const id of ids) this.unavailable.add(id)
    const deletion = Promise.all(ids.map((id) => this.tails.get(id))).then(operation)
    const tail = deletion.then(
      () => {},
      () => {}
    )
    for (const id of ids) this.tails.set(id, tail)
    void tail.then(() => {
      for (const id of ids) {
        if (this.tails.get(id) === tail) this.tails.delete(id)
        this.creationOrder.delete(id)
        this.pendingRecoveryClear.delete(id)
      }
    })
    return deletion.catch((error: unknown) => {
      for (const id of ids) this.unavailable.delete(id)
      throw error
    })
  }

  /** Release a deletion fence after an explicit import has published its rows. */
  forget(sessionId: string): void {
    this.unavailable.delete(sessionId)
    this.creationOrder.delete(sessionId)
    this.pendingRecoveryClear.delete(sessionId)
  }

  async withBackupAccess<T>(action: () => Promise<T>): Promise<T> {
    if (this.backupProtected) throw new BackupOperationBusyError()
    this.backupProtected = true
    try {
      await Promise.all(this.tails.values())
      return await action()
    } finally {
      this.backupProtected = false
    }
  }

  private enqueue<T>(sessionId: string, operation: () => Promise<T>, creating = false): Promise<T> {
    if (this.backupProtected) return Promise.reject(new BackupOperationBusyError())
    if (!creating && this.unavailable.has(sessionId)) return Promise.reject(new SessionNotFoundError(sessionId))
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(
      () => {},
      () => {}
    )
    this.tails.set(sessionId, tail)
    void tail.then(() => {
      if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId)
    })
    return result
  }
}
