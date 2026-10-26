import type { SessionSearchWindowRequest, SessionSearchCandidatesRequest } from '../../ports/session-search-source'
import type { SessionArtifactRequest } from '../../ports/session-artifact-source'
import type { SessionCopyRequest } from '../../ports/session-row-repository'
import type { SessionTokenCacheResult } from '../../ports/session-token-cache'
import type { SessionConversationStateRequest } from '../../ports/session-row-repository'
import type { SessionGenerationControlRequest } from '../../ports/session-row-repository'
import type { SessionTokenPlanRequest, SessionTokenPageRequest } from '../../ports/session-token-source'
import type { SessionCommandWriteOptions, SessionCommandWriteResult } from './SessionWriteCoordinator'
import { SessionNotFoundError, type SessionWriteCoordinator } from './SessionWriteCoordinator'
import type {
  SessionStructureOperation,
  SessionStructureResult,
  CurrentThreadIdentity,
} from '../../ports/session-structure-command'
import type { SessionCommand } from '../../ports/session-repository'
import type {
  LoggerPort,
  SessionFolderStorePort,
  SessionRepositoryPort,
  SessionHeaderRead,
  SessionForkOptionsRequest,
} from '../../ports'
import type { SessionContextRequest } from '../../ports/session-context-source'
import type { SessionMessageDerivedWriteResult } from '../../ports/session-message-source'
import type { SessionMessagesRequest, SessionThreadPageRequest } from '../../ports/session-row-store'
import type {
  SessionTranscriptRequest,
  SessionThreadRequest,
  SessionNavigationRepairRequest,
} from '../../ports/session-transcript-source'
import type { SessionTextTokenResult, SessionTextTokenWriteResult } from '../../ports/session-text-tokens'
import type {
  Message,
  SessionHeader,
  SessionFolder,
  SessionMetaPage,
  SessionMetaRecord,
  SessionSettings,
  Updater,
} from '../../types'
import type { SessionMessageDerivedPatch } from './message-derived-data'
import type { MessageInsertOptions } from './message-command-types'
import type { SessionEventBus } from './session-events'
import { createSessionMetaRecord } from './session-metadata'
import { directoryFolderName, findDirectoryFolder, getSessionWorkingDirectory } from './working-directory-folders'

export interface SessionServiceOptions {
  createId: () => string
  getActiveGenerationMessageIds?: (sessionId: string) => ReadonlySet<string>
  logger?: LoggerPort
  now?: () => number
  getLastUsedModels?: () => {
    chat?: Partial<SessionSettings>
    picture?: Partial<SessionSettings>
  }
  /** Durable folder definitions. Without it folders live for the process only. */
  folders?: SessionFolderStorePort
  /** Current saved copilot name, independent of conversation and thread titles. */
  getCopilotName?: (copilotId: string) => Promise<string | undefined>
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

export interface UpdateSessionOptions extends SessionCommandWriteOptions {
  preserveCachedGeneratingMessages?: boolean
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
  private bootTime = Date.now()
  private recoveryEpoch = 0
  private readonly unsubscribeRecoveryEvents: () => void
  private readonly recoveredSessions = new Set<string>()
  private readonly recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false
  private readonly now: () => number
  private readonly getLastUsedModels: NonNullable<SessionServiceOptions['getLastUsedModels']>
  private readonly getVisibleSessionMetas: NonNullable<SessionServiceOptions['getVisibleSessionMetas']>
  private readonly pendingMetaRepairs = new Set<string>()
  private readonly pendingRecordRepairs = new Set<string>()
  private readonly pendingArchiveListRefreshes = new Set<string>()
  private archiveStateRevision = 0
  private initialization: Promise<void> | null = null
  private readonly folderStore: SessionFolderStorePort
  private folders: Promise<SessionFolder[]> | null = null
  private folderWrites: Promise<unknown> = Promise.resolve()

  constructor(
    readonly repository: SessionRepositoryPort,
    readonly writes: SessionWriteCoordinator,
    readonly events: SessionEventBus,
    private readonly options: SessionServiceOptions
  ) {
    this.now = options.now ?? (() => Date.now())
    this.getLastUsedModels = options.getLastUsedModels ?? (() => ({}))
    this.folderStore = options.folders ?? createMemoryFolderStore()
    this.unsubscribeRecoveryEvents = events.subscribe((event) => {
      if (event.type === 'session-deleted') this.resetGenerationRecovery()
    })
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.repository.initialize()
    }
    return this.initialization
  }

  async getSessionHeader(sessionId: string) {
    await this.initialize()
    try {
      return await this.repository.getSessionHeader(sessionId)
    } catch (error) {
      await this.log('error', 'Failed to read session from repository', {
        sessionId,
        error: describeError(error),
      })
      throw error
    }
  }

  async readSessionSearchWindow(request: SessionSearchWindowRequest) {
    await this.initialize()
    return this.repository.readSessionSearchWindow(request)
  }

  async readSessionSearchCandidates(request: SessionSearchCandidatesRequest) {
    await this.initialize()
    return this.repository.readSessionSearchCandidates(request)
  }

  async readSessionTranscriptWindow(request: SessionTranscriptRequest) {
    await this.initialize()
    const page = await this.repository.readSessionTranscriptWindow(request)
    if (
      page &&
      !this.disposed &&
      !this.recoveredSessions.has(request.sessionId) &&
      !this.recoveryTimers.has(request.sessionId)
    ) {
      const timer = setTimeout(() => {
        this.recoveryTimers.delete(request.sessionId)
        void this.recoverInterruptedGenerations(request.sessionId).catch((error) => {
          void this.options.logger?.log('error', 'Interrupted generation recovery failed', {
            sessionId: request.sessionId,
            error: describeError(error),
          })
        })
      }, 0)
      this.recoveryTimers.set(request.sessionId, timer)
    }
    return page
  }

  async recoverInterruptedGenerations(sessionId: string): Promise<void> {
    await this.initialize()
    if (this.recoveredSessions.has(sessionId) || this.disposed) return
    this.recoveredSessions.add(sessionId)
    const epoch = this.recoveryEpoch
    try {
      for (const messageId of await this.repository.readSessionGeneratingMessageIds(sessionId)) {
        if (this.disposed || epoch !== this.recoveryEpoch) return
        if (this.options.getActiveGenerationMessageIds?.(sessionId).has(messageId)) continue
        await this.executeStructureCommand(sessionId, {
          action: 'message-recover',
          messageId,
          replacementPivotId: this.options.createId(),
          bootTime: this.bootTime,
          now: this.now(),
        })
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    } catch (error) {
      this.recoveredSessions.delete(sessionId)
      throw error
    }
  }

  resetGenerationRecovery(bootTime = this.bootTime): void {
    this.bootTime = bootTime
    this.recoveryEpoch++
    this.recoveredSessions.clear()
    for (const timer of this.recoveryTimers.values()) clearTimeout(timer)
    this.recoveryTimers.clear()
  }

  dispose(): void {
    this.disposed = true
    this.resetGenerationRecovery()
    this.unsubscribeRecoveryEvents()
  }

  async readSessionNavigationPage(request: SessionTranscriptRequest) {
    await this.initialize()
    return this.repository.readSessionNavigationPage(request)
  }

  async repairSessionNavigationProjections(request: SessionNavigationRepairRequest) {
    await this.initialize()
    return this.repository.repairSessionNavigationProjections(request)
  }

  async readSessionThread(request: SessionThreadRequest) {
    await this.initialize()
    return this.repository.readSessionThread(request)
  }

  async readSessionThreadSummariesPage(request: SessionThreadPageRequest) {
    await this.initialize()
    return this.repository.readSessionThreadSummariesPage(request)
  }

  async readSessionForkOptionsPage(request: SessionForkOptionsRequest) {
    await this.initialize()
    return this.repository.readSessionForkOptionsPage(request)
  }

  async readSessionNamingMessages(request: { sessionId: string; expectedRevision: number }) {
    await this.initialize()
    return this.repository.readSessionNamingMessages(request)
  }

  async readSessionConversationState(request: SessionConversationStateRequest) {
    await this.initialize()
    return this.repository.readSessionConversationState(request)
  }

  async acceptSessionTokenCacheResults(sessionId: string, results: readonly SessionTokenCacheResult[]): Promise<void> {
    await this.initialize()
    await this.repository.acceptSessionTokenCacheResults(sessionId, results)
  }

  async createSessionTokenPlan(request: SessionTokenPlanRequest) {
    await this.initialize()
    return this.repository.createSessionTokenPlan(request)
  }

  async readSessionTokenPage(request: SessionTokenPageRequest) {
    await this.initialize()
    return this.repository.readSessionTokenPage(request)
  }

  async *iterateSessionArtifactMarkdown(request: SessionArtifactRequest): AsyncIterable<string> {
    await this.initialize()
    yield* this.repository.iterateSessionArtifactMarkdown(request)
  }

  async getSessionContextSource(request: SessionContextRequest) {
    await this.initialize()
    return this.repository.getSessionContextSource(request)
  }

  async readSessionMessages(request: SessionMessagesRequest) {
    await this.initialize()
    return this.repository.readSessionMessages(request)
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

  /** Refresh projections after a host-owned durable restore. */
  async reloadFromStorage(): Promise<void> {
    this.resetGenerationRecovery()
    this.folders = null
    const folders = await this.listSessionFolders()
    await this.events.publish({ type: 'session-folders-changed', folders })
    await this.publishListReset({ visible: true, archived: true })
  }

  /**
   * Applies `update` to the current folder list and returns the resulting
   * list; `null` leaves it unchanged. Folder writes run one at a time, so
   * concurrent callers never overwrite each other's changes. Sessions are not
   * rewritten: a session whose folder is gone is listed as unfiled (see
   * `getSessionListGroup`).
   */
  updateSessionFolders(update: (folders: SessionFolder[]) => SessionFolder[] | null): Promise<SessionFolder[]> {
    const write = this.folderWrites.then(async () => {
      const current = await this.listSessionFolders()
      const next = update(current)
      if (!next) return current
      await this.folderStore.save(next)
      this.folders = Promise.resolve(next)
      await this.events.publish({ type: 'session-folders-changed', folders: next })
      await this.publishListReset({ visible: true })
      return next
    })
    this.folderWrites = write.catch(() => undefined)
    return write
  }

  async saveSessionFolders(folders: SessionFolder[]): Promise<void> {
    await this.updateSessionFolders(() => folders)
  }

  /** Id of the folder that collects `directory`, created when it is missing. */
  private async getDirectoryFolderId(directory: string): Promise<string | undefined> {
    const folders = await this.updateSessionFolders((current) =>
      findDirectoryFolder(current, directory)
        ? null
        : [
            ...current,
            {
              id: this.options.createId(),
              name: directoryFolderName(directory, current),
              workingDirectory: directory,
            },
          ]
    )
    return findDirectoryFolder(folders, directory)?.id
  }

  /** New copilot conversations share a folder keyed by the copilot's identity. */
  private async resolveCopilotFolder(session: SessionHeader, copilotName?: string): Promise<string | undefined> {
    const copilotId = session.copilotId
    if (!this.options.folders || !copilotId || getSessionWorkingDirectory(session) !== undefined) return undefined
    try {
      if (session.folderId && (await this.listSessionFolders()).some((folder) => folder.id === session.folderId)) {
        return undefined
      }
      const existing = (await this.listSessionFolders()).find((folder) => folder.copilotId === copilotId)
      if (existing) return existing.id
      const name = copilotName?.trim() || (await this.options.getCopilotName?.(copilotId))?.trim()
      const folders = await this.updateSessionFolders((current) =>
        !name || current.some((folder) => folder.copilotId === copilotId)
          ? null
          : [...current, { id: this.options.createId(), name, copilotId }]
      )
      return folders.find((folder) => folder.copilotId === copilotId)?.id
    } catch (error) {
      await this.log('warn', 'Failed to file session by copilot', {
        sessionId: session.id,
        error: describeError(error),
      })
      return undefined
    }
  }

  /**
   * Folder a Work Mode session should be filed in after its working directory
   * became `directory`, or `undefined` when its current placement stays: a
   * folder the user picked is kept, while an unfiled session and one still in
   * the previous directory's folder follow the directory.
   */
  private async resolveDirectoryFolder(
    session: SessionHeader,
    previousDirectory: string | undefined
  ): Promise<string | undefined> {
    const directory = getSessionWorkingDirectory(session)
    if (!this.options.folders || directory === undefined || directory === previousDirectory) return undefined
    try {
      if (session.folderId) {
        const current = (await this.listSessionFolders()).find((folder) => folder.id === session.folderId)
        const followsCopilot = session.copilotId !== undefined && current?.copilotId === session.copilotId
        if (
          current &&
          !followsCopilot &&
          (previousDirectory === undefined || current.workingDirectory !== previousDirectory)
        ) {
          return undefined
        }
      }
      const folderId = await this.getDirectoryFolderId(directory)
      return folderId === session.folderId ? undefined : folderId
    } catch (error) {
      await this.log('warn', 'Failed to file session by working directory', {
        sessionId: session.id,
        error: describeError(error),
      })
      return undefined
    }
  }

  /**
   * Moves a session into a folder (or out of any folder with `undefined`),
   * optionally placing it at `sortOrder` within the target group.
   */
  async moveSessionToFolder(sessionId: string, folderId: string | undefined, sortOrder?: number): Promise<void> {
    await this.updateSessionHeader(sessionId, { folderId })
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

  async createSession(
    newSession: Omit<SessionHeader, 'id'> & { messages?: readonly Message[] },
    previousId?: string,
    options?: { copilotName?: string }
  ): Promise<SessionHeader> {
    await this.initialize()
    const { messages = [], ...fields } = newSession
    const lastUsedModels = this.getLastUsedModels()
    const header: SessionHeader = {
      ...fields,
      id: this.options.createId(),
      threadName: fields.threadName ?? '',
      settings: { ...(fields.type === 'picture' ? lastUsedModels.picture : lastUsedModels.chat), ...fields.settings },
    }
    const directoryFolderId = await this.resolveDirectoryFolder(header, undefined)
    if (directoryFolderId) header.folderId = directoryFolderId
    const copilotFolderId = await this.resolveCopilotFolder(header, options?.copilotName)
    if (copilotFolderId) header.folderId = copilotFolderId
    let sortOrder = this.now()
    if (previousId) {
      const records = [...(await this.repository.meta.getAllIncludingHidden())].sort(
        (a, b) => b.sortOrder - a.sortOrder
      )
      const previous = records.find((item) => item.id === previousId && !item.hidden)
      if (previous) {
        const lower = records.find((item) => item.sortOrder < previous.sortOrder)
        sortOrder = lower ? (previous.sortOrder + lower.sortOrder) / 2 : previous.sortOrder - 2000
      }
    }
    const result = await this.writes.create(header, messages, sortOrder, this.now())
    await this.publishCommandResult(result, true)
    if (result.meta)
      await this.events.publish({
        type: 'session-created',
        session: result.delta.header,
        record: result.meta,
        revision: result.delta.revision,
      })
    await this.handleProjectionFailure(result)
    return result.delta.header
  }

  async copySessionThread(request: {
    sessionId: string
    threadId: string
    expectedRevision: number
  }): Promise<SessionHeader> {
    const { threadId, ...source } = request
    return this.copySession({ ...source, scope: { type: 'thread', threadId } })
  }

  async copySession(
    request: Pick<SessionCopyRequest, 'sessionId' | 'expectedRevision' | 'scope'> & { appendForkMarker?: boolean }
  ): Promise<SessionHeader> {
    await this.initialize()
    const createdAt = this.now()
    const sourceMeta = await this.repository.meta.getById(request.sessionId)
    const records = await this.repository.meta.getAllIncludingHidden()
    const below =
      sourceMeta &&
      records.filter((row) => row.sortOrder < sourceMeta.sortOrder).sort((a, b) => b.sortOrder - a.sortOrder)[0]
    const sortOrder = sourceMeta
      ? below
        ? (sourceMeta.sortOrder + below.sortOrder) / 2
        : sourceMeta.sortOrder - 2000
      : createdAt
    const result = await this.writes.copy(
      {
        sessionId: request.sessionId,
        expectedRevision: request.expectedRevision,
        scope: request.scope,
        targetSessionId: this.options.createId(),
        createdAt,
        ...(request.appendForkMarker ? { appendForkMarkerId: this.options.createId() } : {}),
      },
      sortOrder
    )
    await this.publishCommandResult(result, true)
    if (result.meta)
      await this.events.publish({
        type: 'session-created',
        session: result.delta.header,
        record: result.meta,
        revision: result.delta.revision,
      })
    await this.handleProjectionFailure(result)
    return result.delta.header
  }

  private publishCommandResult(
    result: SessionCommandWriteResult,
    preserveCachedGeneratingMessages: boolean
  ): Promise<void> {
    return this.events.publish({
      type: 'session-command-committed',
      delta: result.delta,
      meta: result.meta,
      metaRevision: result.metaRevision,
      preserveCachedGeneratingMessages,
    })
  }

  private async handleProjectionFailure(result: SessionCommandWriteResult): Promise<void> {
    if (result.delta.recordProjectionError !== undefined) this.pendingRecordRepairs.add(result.delta.sessionId)
    if (result.projectionError === undefined && result.delta.recordProjectionError === undefined) return
    if (
      result.delta.previousHeader?.hidden !== result.delta.header.hidden ||
      result.delta.previousHeader?.archivedAt !== result.delta.header.archivedAt
    )
      this.pendingArchiveListRefreshes.add(result.delta.sessionId)
    this.scheduleMetaProjectionRepair(result.delta.sessionId)
    await this.log('warn', 'Session rows committed; metadata projection will be retried', {
      sessionId: result.delta.sessionId,
      error: describeError(result.projectionError ?? result.delta.recordProjectionError),
    })
  }

  private async persistCommand(
    sessionId: string,
    command: SessionCommand,
    options: UpdateSessionOptions = {},
    onCommitted?: (result: SessionStructureResult) => void
  ): Promise<SessionCommandWriteResult> {
    await this.initialize()
    const result = await this.writes.executeCommand(sessionId, command, options)
    await this.publishCommandResult(result, options.preserveCachedGeneratingMessages !== false)
    await this.handleProjectionFailure(result)
    // Observers cannot turn a durable append into a retryable write failure.
    try {
      options.onPersisted?.(result.delta.header)
      if (result.delta.structureResult) onCommitted?.(result.delta.structureResult)
    } catch (error) {
      await this.log('warn', 'Session commit observer failed', { sessionId, error: describeError(error) })
    }
    if (command.type === 'header') {
      const previousDirectory = result.delta.previousHeader
        ? getSessionWorkingDirectory(result.delta.previousHeader)
        : undefined
      const folderId = await this.resolveDirectoryFolder(result.delta.header, previousDirectory)
      if (folderId) {
        try {
          return await this.persistCommand(sessionId, { type: 'header', updater: { folderId } })
        } catch (error) {
          await this.log('warn', 'Failed to file session by working directory', {
            sessionId,
            error: describeError(error),
          })
        }
      }
    }
    return result
  }

  async readSessionBranchPreview(request: import('../../ports/session-branch-source').SessionBranchPreviewRequest) {
    await this.initialize()
    return this.repository.readSessionBranchPreview(request)
  }

  async readSessionBranchMessagesPage(
    request: import('../../ports/session-branch-source').SessionBranchMessagesRequest
  ) {
    await this.initialize()
    return this.repository.readSessionBranchMessagesPage(request)
  }

  async readPreviousUserMessage(sessionId: string, targetMessageId: string) {
    await this.initialize()
    return this.repository.readPreviousUserMessage(sessionId, targetMessageId)
  }

  async shouldConfirmPromptCacheBreak(
    sessionId: string,
    options: Omit<import('../../ports/session-prompt-cache-source').SessionPromptCacheRequest, 'sessionId' | 'deletion'>
  ) {
    await this.initialize()
    return this.repository.readSessionPromptCacheDecision({ sessionId, ...options })
  }

  async shouldConfirmPromptCacheDelete(
    sessionId: string,
    messageId: string,
    target: import('../../session/prompt-cache-policy').PromptCacheDeleteTarget,
    options: Omit<import('../../ports/session-prompt-cache-source').SessionPromptCacheRequest, 'sessionId' | 'deletion'>
  ) {
    await this.initialize()
    return this.repository.readSessionPromptCacheDecision({ sessionId, ...options, deletion: { messageId, target } })
  }

  async readSessionGenerationControl(request: SessionGenerationControlRequest) {
    await this.initialize()
    return this.repository.readSessionGenerationControl(request)
  }

  async getCurrentThreadIdentity(sessionId: string): Promise<CurrentThreadIdentity | null> {
    await this.initialize()
    return this.repository.getCurrentThreadIdentity(sessionId)
  }

  async commitSessionCompaction(
    sessionId: string,
    operation: import('../../ports/session-structure-command').SessionCompactionOperation
  ): Promise<{ applied: boolean; revision: number }> {
    const result = await this.persistCommand(sessionId, { type: 'structure', operation }, {})
    return { applied: result.delta.structureResult?.applied === true, revision: result.delta.revision }
  }

  async executeStructureCommand(
    sessionId: string,
    operation: SessionStructureOperation,
    onCommitted?: (result: SessionStructureResult) => void
  ): Promise<SessionStructureResult | null> {
    const result = await this.persistCommand(sessionId, { type: 'structure', operation }, {}, onCommitted)
    return result.delta.structureResult ?? null
  }

  async updateSessionHeader(
    sessionId: string,
    updater: Updater<SessionHeader>,
    options: UpdateSessionOptions = {}
  ): Promise<SessionHeader> {
    return (await this.persistCommand(sessionId, { type: 'header', updater }, options)).delta.header
  }

  async insertMessage(
    sessionId: string,
    message: Message,
    previousId?: string,
    options: MessageInsertOptions & UpdateSessionOptions = {}
  ): Promise<void> {
    await this.persistCommand(
      sessionId,
      previousId
        ? {
            type: 'structure',
            operation: { action: 'message-insert-after', message, previousId, requireAnchor: options.requireAnchor },
          }
        : { type: 'append', messages: [message] },
      options
    )
  }

  async insertMessages(sessionId: string, messages: readonly Message[]): Promise<void> {
    if (messages.length) await this.persistCommand(sessionId, { type: 'append', messages })
  }

  async insertMessagesAtRevision(
    sessionId: string,
    messages: readonly Message[],
    revision: number,
    onPersisted?: (header: SessionHeader) => void
  ): Promise<SessionHeader> {
    return (
      await this.persistCommand(sessionId, { type: 'append', messages }, { expectedRevision: revision, onPersisted })
    ).delta.header
  }

  async updateMessage(sessionId: string, messageId: string, updater: Updater<Message>): Promise<void> {
    await this.persistCommand(sessionId, { type: 'update', messageId, updater })
  }

  async removeMessage(
    sessionId: string,
    messageId: string,
    onPersisted?: (header: SessionHeader) => void
  ): Promise<void> {
    await this.persistCommand(
      sessionId,
      {
        type: 'structure',
        operation: { action: 'message-remove', messageId, replacementPivotId: this.options.createId() },
      },
      { onPersisted }
    )
  }

  async setSessionSystemPrompt(sessionId: string, text: string): Promise<SessionHeader> {
    const result = await this.persistCommand(sessionId, {
      type: 'structure',
      operation: {
        action: 'set-system-prompt',
        text,
        messageId: this.options.createId(),
        replacementPivotId: this.options.createId(),
        now: this.now(),
      },
    })
    return result.delta.header
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
      await this.repository.deleteSession(sessionId, () => this.repository.meta.delete(sessionId))
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
      await runInChunks(uniqueIds, 20, (sessionId) =>
        this.repository.deleteSession(sessionId, () => this.repository.meta.delete(sessionId))
      )
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
        await this.updateSessionHeader(
          sessionId,
          { hidden: true, archivedAt },
          {
            onPersisted: () => {
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
    if (!uniqueIds.some((id) => this.pendingArchiveListRefreshes.has(id)))
      await this.publishListReset({ visible: true, archived: true })
  }

  async restoreSession(sessionId: string): Promise<void> {
    await this.updateArchiveState(sessionId, false)
  }

  private async updateArchiveState(sessionId: string, hidden: boolean): Promise<void> {
    const result = await this.persistCommand(
      sessionId,
      { type: 'header', updater: { hidden, archivedAt: hidden ? this.now() : undefined } },
      { clearRecoveryArchive: !hidden }
    )
    const revision = ++this.archiveStateRevision
    if (result.projectionError !== undefined) {
      this.pendingArchiveListRefreshes.add(sessionId)
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
    const sessionsWithTimestamp: Array<{ read: SessionHeaderRead; timestamp: number }> = []
    const failedSessionIds: string[] = []
    for (const sessionId of sessionIds) {
      try {
        const read = await this.getSessionHeader(sessionId)
        if (!read) continue
        const thread = await this.readSessionThread({ sessionId, expectedRevision: read.revision })
        sessionsWithTimestamp.push({ read, timestamp: thread?.thread.createdAt ?? 0 })
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
    const records = sessionsWithTimestamp.map(({ read, timestamp }, index) => {
      const recoveredRecord = createSessionMetaRecord(
        read.header,
        timestamp || now - (sessionsWithTimestamp.length - index) * 1000,
        timestamp || now - (sessionsWithTimestamp.length - index) * 1000,
        read.summary.pausedMessageCount > 0
      )
      const existingArchivedRecord = existingArchivedRecords.get(read.header.id)
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
      if (this.pendingRecordRepairs.has(sessionId)) {
        await this.repository.repairSessionRecordProjection(sessionId)
        this.pendingRecordRepairs.delete(sessionId)
      }
      const result = await this.writes.reprojectMeta(sessionId)
      if (!result?.meta || result.metaRevision === null) return
      await this.events.publish({
        type: 'session-meta-projected',
        sessionId,
        meta: result.meta,
        revision: result.metaRevision,
      })
      if (refreshArchiveLists) await this.refreshArchiveLists(sessionId, ++this.archiveStateRevision)
    } catch (error) {
      await this.log('warn', 'Failed to repair session metadata projection', { sessionId, error: describeError(error) })
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
