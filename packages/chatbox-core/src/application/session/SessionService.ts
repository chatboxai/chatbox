import { findMessageLocation } from '@shared/session/message-forks'
import {
  assertSessionThreadPageRevision,
  validateSessionThreadPageRequest,
} from '../../persistence/session-thread-page'
import type { LoggerPort, SessionFolderStorePort, SessionRepositoryPort } from '../../ports'
import type { SessionContextRequest, SessionContextSource } from '../../ports/session-context-source'
import type { SessionMessageDerivedWriteResult, SessionMessagesSource } from '../../ports/session-message-source'
import type {
  SessionReadModel,
  SessionSearchThreadsPage,
  SessionSearchThreadsPageRequest,
} from '../../ports/session-read-model'
import { sessionReadModelHeader } from '../../ports/session-read-model'
import type { SessionMessageWindow, SessionMessageWindowRequest } from '../../ports/session-row-store'
import { type SessionMessagesRequest, SessionRowConflictError } from '../../ports/session-row-store'
import type { SessionTextTokenResult, SessionTextTokenWriteResult } from '../../ports/session-text-tokens'
import type {
  Message,
  Session,
  SessionFolder,
  SessionMetaPage,
  SessionMetaRecord,
  SessionSettings,
  Updater,
} from '../../types'
import type { SessionMessageDerivedPatch } from './message-derived-data'
import {
  applyMessageInsert,
  applyMessageRemoval,
  applyMessagesReplace,
  applyMessageUpdate,
  type MessageInsertOptions,
} from './message-tree'
import {
  SessionMetadataUpdateError,
  SessionNotFoundError,
  type SessionWriteCoordinator,
  type SessionWriteResult,
} from './SessionWriteCoordinator'
import { contextSourceFromSession } from './session-context-source'
import type { SessionEventBus } from './session-events'
import {
  assertNoMessageDataUpdate,
  createSessionMetaRecord,
  getSessionMetadataSnapshot,
  hasMessageDataFields,
  hasSessionMetaFields,
  type SessionMetadataUpdate,
} from './session-metadata'

export interface SessionServiceOptions {
  createId: () => string
  logger?: LoggerPort
  now?: () => number
  getLastUsedModels?: () => {
    chat?: Partial<SessionSettings>
    picture?: Partial<SessionSettings>
  }
  repairSessionOnRead?: (session: Session) => { session: Session; changed: boolean }
  /** Durable folder definitions. Without it folders live for the process only. */
  folders?: SessionFolderStorePort
}

function createMemoryFolderStore(): SessionFolderStorePort {
  let folders: SessionFolder[] = []
  return {
    load: () => Promise.resolve(folders),
    save: (next) => {
      folders = next
      return Promise.resolve()
    },
  }
}

function describeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const cause = 'cause' in error ? error.cause : undefined
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(cause === undefined ? {} : { cause: describeError(cause) }),
  }
}

export interface UpdateSessionOptions {
  preserveCachedGeneratingMessages?: boolean
  /**
   * Only this message's content differs from the session as it was last
   * persisted; the storage layer may use it to write a single row. Entry points
   * that insert, remove or move messages must leave it unset.
   */
  changedMessageId?: string
  /** Runs once the full Session is durable, even if its metadata projection fails afterward. */
  onFullSessionPersisted?: (session: Session) => void
  /** Internal recovery path: a successful full write supersedes a metadata-only archive. */
  clearRecoveryArchive?: boolean
}

async function runInChunks<T>(items: T[], chunkSize: number, worker: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += chunkSize) {
    const results = await Promise.allSettled(items.slice(index, index + chunkSize).map((item) => worker(item)))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }
}

const META_PROJECTION_REPAIR_DELAY_MS = 1000

export class SessionService {
  private readonly now: () => number
  private readonly getLastUsedModels: NonNullable<SessionServiceOptions['getLastUsedModels']>
  private readonly getVisibleSessionMetas: NonNullable<SessionServiceOptions['getVisibleSessionMetas']>
  private readonly pendingMetaRepairs = new Set<string>()
  private readonly pendingArchiveListRefreshes = new Set<string>()
  private archiveStateRevision = 0
  private initialization: Promise<void> | null = null
  private readonly folderStore: SessionFolderStorePort
  private folders: Promise<SessionFolder[]> | null = null

  constructor(
    readonly repository: SessionRepositoryPort,
    readonly writes: SessionWriteCoordinator,
    readonly events: SessionEventBus,
    private readonly options: SessionServiceOptions
  ) {
    this.now = options.now ?? (() => Date.now())
    this.getLastUsedModels = options.getLastUsedModels ?? (() => ({}))
    this.folderStore = options.folders ?? createMemoryFolderStore()
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.repository.initialize()
    }
    return this.initialization
  }

  async getSession(sessionId: string): Promise<Session | null> {
    await this.initialize()
    try {
      const session = await this.repository.getSession(sessionId)
      return await this.repairReadSession(session)
    } catch (error) {
      await this.log('error', 'Failed to read session from repository', {
        sessionId,
        error: describeError(error),
      })
      throw error
    }
  }

  private async repairReadSession(session: Session | null): Promise<Session | null> {
    const sessionId = session?.id
    const repairSessionOnRead = this.options.repairSessionOnRead
    if (!session || !repairSessionOnRead || !repairSessionOnRead(session).changed) {
      return session
    }

    const result = await this.writes.updateFromSnapshot(
      session,
      (current) => {
        if (!current) throw new Error(`Session ${sessionId} not found`)
        const repair = repairSessionOnRead(current)
        return repair.changed ? repair.session : current
      },
      { updateMeta: false }
    )
    await this.events.publish({
      type: 'session-updated',
      session: result.session,
      meta: null,
      // A first read can overlap a streaming cache update. Keep in-flight
      // chunks; the merge only maps over messages that still exist.
      preserveCachedGeneratingMessages: true,
    })
    return result.session
  }

  async getSessionReadModel(sessionId: string): Promise<SessionReadModel | null> {
    await this.initialize()
    const model = await this.repository.getSessionReadModel?.(sessionId)
    if (model === null) return null
    if (model?.kind === 'window') return model
    const session =
      model?.kind === 'full' ? await this.repairReadSession(model.session) : await this.getSession(sessionId)
    return session ? { kind: 'full', session, textTokens: model?.kind === 'full' ? model.textTokens : undefined } : null
  }

  async getCompleteSessionSource(sessionId: string) {
    await this.initialize()
    if (this.repository.getCompleteSessionSource) {
      const source = await this.repository.getCompleteSessionSource(sessionId)
      const session = source ? await this.repairReadSession(source.session) : null
      return session ? { ...source, session } : null
    }
    const session = await this.getSession(sessionId)
    return session ? { session } : null
  }

  async readSessionSearchThreadsPage(
    request: SessionSearchThreadsPageRequest
  ): Promise<SessionSearchThreadsPage | null> {
    await this.initialize()
    validateSessionThreadPageRequest(request)
    if (this.repository.readSessionSearchThreadsPage) return this.repository.readSessionSearchThreadsPage(request)
    assertSessionThreadPageRevision(request, null)
    const session = await this.getSession(request.sessionId)
    return session ? { kind: 'full', session } : null
  }

  async readSessionMessageWindow(request: SessionMessageWindowRequest): Promise<SessionMessageWindow | null> {
    await this.initialize()
    if (!this.repository.readSessionMessageWindow) throw new Error('Session window reads are unavailable')
    return this.repository.readSessionMessageWindow(request)
  }

  async getSessionContextSource(request: SessionContextRequest): Promise<SessionContextSource | null> {
    await this.initialize()
    if (this.repository.getSessionContextSource) return this.repository.getSessionContextSource(request)
    if (request.expectedRevision !== undefined)
      throw new SessionRowConflictError(request.sessionId, request.expectedRevision, null)
    const session = await this.getSession(request.sessionId)
    return session ? contextSourceFromSession(session, request) : null
  }

  async readSessionMessages(request: SessionMessagesRequest): Promise<SessionMessagesSource | null> {
    await this.initialize()
    if (this.repository.readSessionMessages) return this.repository.readSessionMessages(request)
    if (request.expectedRevision !== undefined)
      throw new SessionRowConflictError(request.sessionId, request.expectedRevision, null)
    const session = await this.getSession(request.sessionId)
    return session
      ? {
          header: sessionReadModelHeader({ kind: 'full', session }),
          revision: null,
          messages: [...new Set(request.messageIds)].flatMap((id) => {
            const location = findMessageLocation(session, id)
            return location ? [location.list[location.index]] : []
          }),
        }
      : null
  }

  async patchSessionMessageDerivedData(
    sessionId: string,
    patches: SessionMessageDerivedPatch[]
  ): Promise<SessionMessageDerivedWriteResult> {
    await this.initialize()
    const result = await this.writes.patchMessageDerivedData(sessionId, patches)
    if (result.patches.length) await this.events.publish({ type: 'session-derived-data-patched', ...result })
    return result
  }

  async acceptSessionTextTokenResults(
    sessionId: string,
    results: readonly SessionTextTokenResult[]
  ): Promise<SessionTextTokenWriteResult> {
    await this.initialize()
    const result = await this.writes.acceptTextTokenResults(sessionId, results)
    if (result.results.length) await this.events.publish({ type: 'session-text-tokens-cached', ...result })
    return result
  }

  listSessionFolders(): Promise<SessionFolder[]> {
    if (!this.folders) {
      this.folders = this.folderStore.load().catch((error) => {
        this.folders = null
        throw error
      })
    }
    return this.folders
  }

  /**
   * Replaces the folder list. Sessions are not rewritten: a session whose
   * folder is gone is listed as unfiled (see `getSessionListGroup`).
   */
  async saveSessionFolders(folders: SessionFolder[]): Promise<void> {
    await this.folderStore.save(folders)
    this.folders = Promise.resolve(folders)
    await this.events.publish({ type: 'session-folders-changed', folders })
    await this.publishListReset({ visible: true })
  }

  /**
   * Moves a session into a folder (or out of any folder with `undefined`),
   * optionally placing it at `sortOrder` within the target group.
   */
  async moveSessionToFolder(sessionId: string, folderId: string | undefined, sortOrder?: number): Promise<void> {
    await this.updateSession(sessionId, { folderId })
    // The session may sit on a page that is not loaded yet, where no cache
    // patch can place it; re-read the first page in the new order.
    if (sortOrder !== undefined) {
      await this.updateSessionSortOrder(sessionId, sortOrder)
    } else {
      await this.publishListReset({ visible: true })
    }
  }

  async listSessionsMetaPage(cursor: number, limit?: number): Promise<SessionMetaPage> {
    await this.initialize()
    try {
      const folderIds = (await this.listSessionFolders()).map((folder) => folder.id)
      return await this.repository.meta.getPage(cursor, limit, folderIds)
    } catch (error) {
      await this.log('error', 'Failed to read session list page from repository', {
        cursor,
        limit,
        error: describeError(error),
      })
      throw error
    }
  }

  async listArchivedSessionsMetaPage(cursor: number, limit?: number): Promise<SessionMetaPage> {
    await this.initialize()
    return this.repository.meta.getArchivedPage(cursor, limit)
  }

  async countSessionsMeta(): Promise<number> {
    await this.initialize()
    return this.repository.meta.getTotal()
  }

  async countArchivedSessionsMeta(): Promise<number> {
    await this.initialize()
    return this.repository.meta.getArchivedTotal()
  }

  async listAllSessionsMeta(): Promise<SessionMetaRecord[]> {
    const items: SessionMetaRecord[] = []
    let cursor: number | null = 0
    while (cursor !== null) {
      const page = await this.listSessionsMetaPage(cursor)
      items.push(...page.items)
      cursor = page.nextCursor
    }
    return items
  }

  async listArchivedSessionsMeta(): Promise<SessionMetaRecord[]> {
    const items: SessionMetaRecord[] = []
    let cursor: number | null = 0
    while (cursor !== null) {
      const page = await this.listArchivedSessionsMetaPage(cursor)
      items.push(...page.items)
      cursor = page.nextCursor
    }
    return items
  }

  async createSession(newSession: Omit<Session, 'id'>, previousId?: string): Promise<Session> {
    await this.initialize()
    const lastUsedModels = this.getLastUsedModels()
    const session: Session = {
      ...newSession,
      id: this.options.createId(),
      // Pending auto-title — not `undefined`, which means a historical field
      // is missing and would be backfilled from `name` (including a copilot name).
      threadName: newSession.threadName ?? '',
      settings: {
        ...(newSession.type === 'picture' ? lastUsedModels.picture : lastUsedModels.chat),
        ...newSession.settings,
      },
    }

    const record = await this.writes.create(session, async () => {
      await this.repository.setSession(session)

      let sortOrder = this.now()
      if (previousId) {
        // The numeric lower bound comes from the full repository rather than a
        // partially loaded list window. It includes hidden records and both pin
        // groups so the new sortOrder stays unique if either record later moves
        // between groups or becomes visible again.
        const records = [...(await this.repository.meta.getAllIncludingHidden())].sort(
          (a, b) => b.sortOrder - a.sortOrder
        )
        const previous = records.find((item) => item.id === previousId && !item.hidden)
        if (previous) {
          const lowerNeighbor = records.find((item) => item.sortOrder < previous.sortOrder)
          sortOrder =
            lowerNeighbor !== undefined ? (previous.sortOrder + lowerNeighbor.sortOrder) / 2 : previous.sortOrder - 2000
        }
      }

      const record = createSessionMetaRecord(session, sortOrder, this.now())
      await this.repository.meta.create(record)
      return record
    })
    await this.events.publish({ type: 'session-created', session, record })
    return session
  }

  async updateSessionWithMessages(
    sessionId: string,
    updater: Updater<Session>,
    options: UpdateSessionOptions = {}
  ): Promise<Session> {
    await this.initialize()
    const updateMeta = typeof updater === 'function' || hasSessionMetaFields(updater) || hasMessageDataFields(updater)
    let result: SessionWriteResult
    try {
      result = await this.writes.update(sessionId, updater, {
        updateMeta,
        clearRecoveryArchive: options.clearRecoveryArchive,
        changedMessageId: options.changedMessageId,
      })
    } catch (error) {
      if (!(error instanceof SessionMetadataUpdateError)) throw error

      // The full session is already durable and is also the coordinator's
      // current snapshot. Project it — including the derived metadata patch —
      // even though the list metadata write failed, otherwise staleTime:
      // Infinity leaves external read models permanently behind and a retry
      // can append the same message again. The persisted metadata record is
      // still stale, so schedule a repair for it too.
      options.onFullSessionPersisted?.(error.session)
      await this.events.publish({
        type: 'session-updated',
        session: error.session,
        meta: error.meta,
        preserveCachedGeneratingMessages: options.preserveCachedGeneratingMessages === true,
      })
      this.scheduleMetaProjectionRepair(sessionId)
      throw error.metadataError
    }
    options.onFullSessionPersisted?.(result.session)
    await this.events.publish({
      type: 'session-updated',
      session: result.session,
      meta: result.meta,
      preserveCachedGeneratingMessages: options.preserveCachedGeneratingMessages === true,
    })
    return result.session
  }

  async insertMessage(
    sessionId: string,
    message: Message,
    previousId?: string,
    options: MessageInsertOptions = {}
  ): Promise<void> {
    await this.updateSessionWithMessages(sessionId, (session) =>
      applyMessageInsert(session, sessionId, message, previousId, options)
    )
  }

  async updateMessage(sessionId: string, messageId: string, updater: Updater<Message>): Promise<void> {
    await this.updateSessionWithMessages(
      sessionId,
      (session) => applyMessageUpdate(session, sessionId, messageId, updater),
      { preserveCachedGeneratingMessages: true, changedMessageId: messageId }
    )
  }

  async updateMessages(sessionId: string, updater: Updater<Message[]>): Promise<Session> {
    return await this.updateSessionWithMessages(sessionId, (session) =>
      applyMessagesReplace(session, sessionId, updater)
    )
  }

  async removeMessage(
    sessionId: string,
    messageId: string,
    onFullSessionPersisted?: (session: Session) => void
  ): Promise<Session> {
    // Messages can be deleted while other replies stream; their cache-only chunk
    // updates must survive this full-session write. Preserving never resurrects
    // the removed message: the merge only maps over messages that still exist.
    return await this.updateSessionWithMessages(
      sessionId,
      (session) => applyMessageRemoval(session, sessionId, messageId, this.options.createId),
      { preserveCachedGeneratingMessages: true, onFullSessionPersisted }
    )
  }

  updateSession(
    sessionId: string,
    updater: Updater<SessionMetadataUpdate>,
    options: Pick<UpdateSessionOptions, 'clearRecoveryArchive' | 'onFullSessionPersisted'> = {}
  ): Promise<Session> {
    return this.updateSessionWithMessages(
      sessionId,
      (session) => {
        if (!session) {
          throw new Error(`Session ${sessionId} not found`)
        }
        const update = typeof updater === 'function' ? updater(getSessionMetadataSnapshot(session)) : updater
        assertNoMessageDataUpdate(update)
        return { ...session, ...update }
      },
      { preserveCachedGeneratingMessages: true, ...options }
    )
  }

  async updateSessionSortOrder(sessionId: string, sortOrder: number): Promise<SessionMetaRecord> {
    await this.initialize()
    const updated = await this.writes.updateSortOrder(sessionId, sortOrder)
    if (!updated) throw new SessionNotFoundError(sessionId)
    await this.publishListReset({ visible: true })
    return updated
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.initialize()
    await this.writes.delete(sessionId, async () => {
      await this.events.publish({
        type: 'session-will-delete',
        ids: [sessionId],
        operation: 'session deletion',
      })
      await this.repository.deleteSession(sessionId)
      await this.repository.meta.delete(sessionId)
      await this.events.publish({ type: 'session-deleted', ids: [sessionId] })
    })
  }

  async deleteSessions(sessionIds: string[]): Promise<void> {
    await this.initialize()
    const uniqueIds = [...new Set(sessionIds)]
    if (uniqueIds.length === 0) return

    await this.writes.deleteMany(uniqueIds, async () => {
      await this.events.publish({
        type: 'session-will-delete',
        ids: uniqueIds,
        operation: 'bulk session deletion',
      })
      await runInChunks(uniqueIds, 20, (sessionId) => this.repository.deleteSession(sessionId))
      await this.repository.meta.deleteMany(uniqueIds)
      await this.events.publish({ type: 'session-deleted', ids: uniqueIds })
    })
    await this.publishListReset({ visible: true, archived: true })
  }

  async archiveSession(sessionId: string): Promise<void> {
    await this.updateArchiveState(sessionId, true)
  }

  /**
   * Archives a session through its list metadata without reading the full record.
   * This recovery path keeps unreadable conversation data intact for later repair or export.
   */
  async archiveSessionWithoutLoading(sessionId: string): Promise<void> {
    await this.initialize()
    const archivedAt = this.now()
    const updated = await this.writes.archiveMetadataOnly(sessionId, archivedAt)
    if (!updated) throw new SessionNotFoundError(sessionId)
    this.archiveStateRevision++
    await this.publishListReset({ visible: true, archived: true })
  }

  /** Restores a session archived through the metadata-only recovery path. */
  async restoreSessionWithoutLoading(sessionId: string): Promise<void> {
    await this.initialize()
    const updated = await this.writes.restoreMetadataOnly(sessionId)
    if (!updated) throw new SessionNotFoundError(sessionId)
    this.archiveStateRevision++
    await this.publishListReset({ visible: true, archived: true })
  }

  async archiveSessions(sessionIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(sessionIds)]
    if (uniqueIds.length === 0) return

    const archivedAt = this.now()
    const missingSessionIds: string[] = []
    await runInChunks(uniqueIds, 20, async (sessionId) => {
      try {
        await this.updateSession(
          sessionId,
          { hidden: true, archivedAt },
          {
            onFullSessionPersisted: () => {
              this.archiveStateRevision++
            },
          }
        )
      } catch (error) {
        if (error instanceof Error && error.message === `Session ${sessionId} not found`) {
          missingSessionIds.push(sessionId)
          return
        }
        throw error
      }
    })

    if (missingSessionIds.length > 0) {
      await this.writes.deleteMany(missingSessionIds, async () => {
        await this.events.publish({
          type: 'session-will-delete',
          ids: missingSessionIds,
          operation: 'stale session meta cleanup',
        })
        await this.repository.meta.deleteMany(missingSessionIds)
        await this.events.publish({ type: 'session-deleted', ids: missingSessionIds })
      })
    }
    await this.publishListReset({ visible: true, archived: true })
  }

  async restoreSession(sessionId: string): Promise<void> {
    await this.updateArchiveState(sessionId, false)
  }

  private async updateArchiveState(sessionId: string, hidden: boolean): Promise<void> {
    let persisted = false
    let revision = this.archiveStateRevision
    try {
      await this.updateSession(
        sessionId,
        { hidden, archivedAt: hidden ? this.now() : undefined },
        {
          clearRecoveryArchive: !hidden,
          onFullSessionPersisted: () => {
            persisted = true
            revision = ++this.archiveStateRevision
          },
        }
      )
    } catch (error) {
      if (!persisted) throw error
      // The live projection already reflects the committed session. Reading stale
      // metadata now would undo it; refresh both lists after the scheduled repair.
      this.pendingArchiveListRefreshes.add(sessionId)
      await this.log('warn', 'Failed to project committed session archive state', {
        sessionId,
        hidden,
        error: describeError(error),
      })
      return
    }
    await this.refreshArchiveLists(sessionId, revision)
  }

  private async refreshArchiveLists(sessionId: string, revision: number): Promise<void> {
    if (revision !== this.archiveStateRevision) return
    try {
      await this.publishListReset({ visible: true, archived: true }, revision)
    } catch (error) {
      await this.log('warn', 'Failed to refresh session lists after archive state was committed', {
        sessionId,
        error: describeError(error),
      })
    }
  }

  async recoverSessionList(): Promise<{ recovered: number; failed: number }> {
    await this.initialize()
    const sessionIds = await this.repository.getAllSessionIds()
    let existingArchivedRecords = new Map<string, SessionMetaRecord>()
    try {
      existingArchivedRecords = new Map(
        (await this.repository.meta.getAllIncludingHidden())
          .filter((record) => record.recoveryArchived === true)
          .map((record) => [record.id, record])
      )
    } catch (error) {
      await this.log('warn', 'Failed to preserve archived metadata during session-list recovery', {
        error: describeError(error),
      })
    }
    const sessionsWithTimestamp: Array<{ session: Session; timestamp: number }> = []
    const failedSessionIds: string[] = []

    for (const sessionId of sessionIds) {
      try {
        const session = await this.getSession(sessionId)
        if (session?.id) {
          sessionsWithTimestamp.push({
            session,
            timestamp: session.messages[0]?.timestamp ?? 0,
          })
        }
      } catch (error) {
        failedSessionIds.push(sessionId)
        await this.log('error', 'Failed to read session during session-list recovery', {
          sessionId,
          error: describeError(error),
        })
      }
    }

    if (failedSessionIds.length > 0) {
      await this.log('warn', 'Failed to recover sessions due to read errors', {
        failed: failedSessionIds.length,
        sessionIds: failedSessionIds,
      })
    }

    sessionsWithTimestamp.sort((left, right) => left.timestamp - right.timestamp)
    const now = this.now()
    const records = sessionsWithTimestamp.map(({ session, timestamp }, index) => {
      const recoveredRecord = createSessionMetaRecord(
        session,
        timestamp || now - (sessionsWithTimestamp.length - index) * 1000,
        timestamp || now - (sessionsWithTimestamp.length - index) * 1000
      )
      const existingArchivedRecord = existingArchivedRecords.get(session.id)
      return existingArchivedRecord
        ? {
            ...recoveredRecord,
            hidden: true,
            archivedAt: existingArchivedRecord.archivedAt,
            recoveryArchived: true,
          }
        : recoveredRecord
    })
    for (const sessionId of failedSessionIds) {
      const existingArchivedRecord = existingArchivedRecords.get(sessionId)
      if (existingArchivedRecord) {
        records.push(existingArchivedRecord)
      }
    }
    await this.repository.meta.clear()
    await this.repository.meta.createMany(records)
    await this.publishListReset({ visible: true, archived: true })
    return { recovered: sessionsWithTimestamp.length, failed: failedSessionIds.length }
  }

  /**
   * One deferred retry per failure burst. If the retry fails as well, give up:
   * any later successful write to the session reprojects its metadata anyway.
   */
  private scheduleMetaProjectionRepair(sessionId: string): void {
    if (this.pendingMetaRepairs.has(sessionId)) return
    this.pendingMetaRepairs.add(sessionId)
    setTimeout(() => {
      this.pendingMetaRepairs.delete(sessionId)
      void this.repairMetaProjection(sessionId)
    }, META_PROJECTION_REPAIR_DELAY_MS)
  }

  private async repairMetaProjection(sessionId: string): Promise<void> {
    const refreshArchiveLists = this.pendingArchiveListRefreshes.delete(sessionId)
    try {
      const result = await this.writes.reprojectMeta(sessionId)
      if (!result) return
      const revision = refreshArchiveLists ? ++this.archiveStateRevision : this.archiveStateRevision
      await this.events.publish({
        type: 'session-updated',
        session: result.session,
        meta: result.meta,
        preserveCachedGeneratingMessages: true,
      })
      if (refreshArchiveLists) await this.refreshArchiveLists(sessionId, revision)
    } catch (error) {
      await this.log('warn', 'Failed to repair session metadata projection', {
        sessionId,
        error: describeError(error),
      })
    }
  }

  private async log(level: 'error' | 'warn', message: string, context: Record<string, unknown>): Promise<void> {
    if (!this.options.logger) return
    try {
      await this.options.logger.log(level, message, context)
    } catch {
      // Diagnostics must not change the outcome of a storage operation.
    }
  }

  private async publishListReset(
    options: { visible?: boolean; archived?: boolean },
    archiveStateRevision = this.archiveStateRevision
  ): Promise<void> {
    const [visible, archived] = await Promise.all([
      options.visible ? this.listSessionsMetaPage(0) : Promise.resolve(undefined),
      options.archived ? this.listArchivedSessionsMetaPage(0) : Promise.resolve(undefined),
    ])
    // A later archive or Undo already published its committed state. Slow page
    // reads must not replace it with a snapshot taken before that operation.
    if (archiveStateRevision !== this.archiveStateRevision) return
    await this.events.publish({ type: 'session-list-reset', visible, archived })
  }
}
