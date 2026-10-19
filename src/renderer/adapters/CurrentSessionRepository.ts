import {
  createSessionMetaRecord,
  MessageAnchorNotFoundError,
  RowBackedSessionRepository,
  SessionMigrationError,
  SessionRowWriteQueue,
} from '@chatbox/core/application/session'
import { SessionActionBlockedError } from '@chatbox/core/session/action-gates'
import { BackupOperationBusyError, type BackupSessionStore, throwIfAborted } from '@chatbox/core/backup'
import {
  type SessionHeaderRead,
  type SessionMetaRepositoryPort,
  SessionRepositoryError,
  type SessionRepositoryOperation,
  type SessionRepositoryPort,
  SessionRowConflictError,
  type SessionRowStorePort,
  type StoredSessionRecord,
  SessionWriteConflictError,
} from '@chatbox/core/ports'
import * as Sentry from '@sentry/react'
import type { Session, SessionHeader, SessionMetaPage, SessionMetaRecord } from '@shared/types'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import storage from '@/storage'
import { rendererBackupSessionStore } from './backup-session-store'
import { type CurrentSessionDataStorage, CurrentSessionRecordStore } from './CurrentSessionRecordStore'
import { collectSessionOwnership } from './session-ownership'

export type { CurrentSessionDataStorage } from './CurrentSessionRecordStore'

export type SessionMigrationOutcome = 'migrated' | 'already' | 'missing'
export interface SessionMigrationCandidate {
  id: string
  recordExists: boolean
}

type RepositoryRows = ConstructorParameters<typeof RowBackedSessionRepository>[0]['rows']

export interface CurrentSessionRepositoryOptions {
  dataStorage?: CurrentSessionDataStorage
  metaStorage?: SessionMetaRepositoryPort
  rowStore?: SessionRowStorePort
}

const log = getLogger('session-repository')
const SESSION_STORAGE_LOCK = 'chatbox-session-storage'
let backupRequested = false
const activeStorageOperations = new Set<Promise<void>>()

function withSharedSessionStorageAccess<Result>(action: () => Promise<Result>): Promise<Result> {
  if (backupRequested) return Promise.reject(new BackupOperationBusyError())
  const result = Promise.resolve().then(async () => {
    if (typeof navigator === 'undefined' || !navigator.locks) return action()
    return navigator.locks.request(SESSION_STORAGE_LOCK, { mode: 'shared', ifAvailable: true }, (lock) => {
      if (!lock) throw new BackupOperationBusyError()
      return action()
    })
  })
  const tail = result
    .then(
      () => {},
      () => {}
    )
    .then(() => {
      activeStorageOperations.delete(tail)
    })
  activeStorageOperations.add(tail)
  return result
}

/** Prevents session writes in every renderer context while raw backup data is replaced. */
export async function withExclusiveSessionStorageLock<Result>(
  action: () => Promise<Result>,
  signal?: AbortSignal
): Promise<Result> {
  if (backupRequested) throw new BackupOperationBusyError()
  backupRequested = true
  try {
    await Promise.all(activeStorageOperations)
    throwIfAborted(signal)
    if (typeof navigator === 'undefined' || !navigator.locks) return await action()
    return await navigator.locks.request(SESSION_STORAGE_LOCK, { mode: 'exclusive', signal }, action)
  } finally {
    backupRequested = false
  }
}

async function normalizeRepositoryError<T>(
  operation: SessionRepositoryOperation,
  action: () => Promise<T>,
  sessionId?: string
): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (
      error instanceof SessionRepositoryError ||
      error instanceof SessionWriteConflictError ||
      error instanceof SessionRowConflictError ||
      error instanceof SessionMigrationError ||
      error instanceof BackupOperationBusyError ||
      error instanceof MessageAnchorNotFoundError ||
      error instanceof SessionActionBlockedError
    )
      throw error
    throw new SessionRepositoryError(operation, error, sessionId)
  }
}

class CurrentSessionMetaRepository implements SessionMetaRepositoryPort {
  private backend: SessionMetaRepositoryPort | null = null

  constructor(private readonly createBackend: () => SessionMetaRepositoryPort) {}

  private getBackend(): SessionMetaRepositoryPort {
    if (!this.backend) {
      this.backend = this.createBackend()
    }
    return this.backend
  }

  initialize(): Promise<void> {
    return normalizeRepositoryError('initialize', () => this.getBackend().initialize())
  }

  create(record: SessionMetaRecord): Promise<void> {
    return normalizeRepositoryError(
      'create-meta',
      () => withSharedSessionStorageAccess(() => this.getBackend().create(record)),
      record.id
    )
  }

  createMany(records: SessionMetaRecord[]): Promise<void> {
    return normalizeRepositoryError('create-meta-many', () =>
      withSharedSessionStorageAccess(() => this.getBackend().createMany(records))
    )
  }

  update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null> {
    return normalizeRepositoryError(
      'update-meta',
      () => withSharedSessionStorageAccess(() => this.getBackend().update(id, updates)),
      id
    )
  }

  getById(id: string): Promise<SessionMetaRecord | null> {
    return normalizeRepositoryError('get-meta', () => this.getBackend().getById(id), id)
  }

  delete(id: string): Promise<void> {
    return normalizeRepositoryError(
      'delete-meta',
      () => withSharedSessionStorageAccess(() => this.getBackend().delete(id)),
      id
    )
  }

  deleteMany(ids: string[]): Promise<void> {
    return normalizeRepositoryError('delete-meta-many', () =>
      withSharedSessionStorageAccess(() => this.getBackend().deleteMany(ids))
    )
  }

  getAll(): Promise<SessionMetaRecord[]> {
    return normalizeRepositoryError('list-meta', () => this.getBackend().getAll())
  }

  getAllIncludingHidden(): Promise<SessionMetaRecord[]> {
    return normalizeRepositoryError('list-meta-including-hidden', () => this.getBackend().getAllIncludingHidden())
  }

  getArchived(): Promise<SessionMetaRecord[]> {
    return normalizeRepositoryError('list-archived-meta', () => this.getBackend().getArchived())
  }

  getArchivedPage(cursor: number, limit?: number): Promise<SessionMetaPage> {
    return normalizeRepositoryError('list-archived-meta-page', () => this.getBackend().getArchivedPage(cursor, limit))
  }

  getPage(cursor: number, limit?: number, folderIds?: readonly string[]): Promise<SessionMetaPage> {
    return normalizeRepositoryError('list-meta-page', () => this.getBackend().getPage(cursor, limit, folderIds))
  }

  getTotal(): Promise<number> {
    return normalizeRepositoryError('count-meta', () => this.getBackend().getTotal())
  }

  getAllTotal(): Promise<number> {
    return normalizeRepositoryError('count-all-meta', () => this.getBackend().getAllTotal())
  }

  getArchivedTotal(): Promise<number> {
    return normalizeRepositoryError('count-archived-meta', () => this.getBackend().getArchivedTotal())
  }

  clear(): Promise<void> {
    return normalizeRepositoryError('clear-meta', () => withSharedSessionStorageAccess(() => this.getBackend().clear()))
  }
}

/**
 * Session repository backed by the storage implementations used by the current
 * Renderer: session records live in the key-value storage, their threads and
 * messages in the platform row store. It intentionally owns no QueryClient or
 * UI side effects.
 */
export class CurrentSessionRepository implements SessionRepositoryPort {
  withBackupStorageAccess<Result>(
    action: (metaStorage: SessionMetaRepositoryPort, backupStore: BackupSessionStore) => Promise<Result>,
    signal?: AbortSignal
  ): Promise<Result> {
    return withExclusiveSessionStorageLock(async () => {
      const metaStorage = this.createMetaStorage()
      await metaStorage.initialize()
      const rows = this.createRowStore()
      if (!('iterateBackupRows' in rows && 'beginBackupRestore' in rows)) {
        throw new Error('Bounded session backup reads are unavailable')
      }
      const dataStorage = this.backupDataStorage
      const snapshots = {
        stage: (token: string, session: Session) => dataStorage.setItemNow(token, session),
        capture: async (id: string, token: string) => {
          if (dataStorage.copyItem) return dataStorage.copyItem(`session:${id}`, token)
          const previous = await this.records.getRecord(id)
          if (previous) await dataStorage.setItemNow(token, previous)
          return previous !== null
        },
        restore: async (id: string, token: string, existed: boolean) => {
          if (!existed) return this.records.removeRecord(id)
          if (dataStorage.copyItem) {
            if (!(await dataStorage.copyItem(token, `session:${id}`)))
              throw new Error('Backup recovery record is missing')
          } else {
            const previous = await dataStorage.getItem<StoredSessionRecord | null>(token, null)
            if (!previous) throw new Error('Backup recovery record is missing')
            await this.records.setRecord(previous)
          }
        },
        remove: (token: string) => dataStorage.removeItem(token),
      }
      const backupStore = rendererBackupSessionStore(
        rows as SessionRowStorePort & BackupSessionStore,
        this.records,
        snapshots,
        {
          listSessionIds: () => this.records.listIds(),
          open: dataStorage.openBackupValue ? (id) => dataStorage.openBackupValue!(`session:${id}`) : undefined,
          readValue: async (id) => {
            const record = await this.records.getRecord(id)
            if (!record || ('storageFormat' in record && record.storageFormat === 'rows')) return null
            return record as Session
          },
        }
      )
      return action(metaStorage, backupStore)
    }, signal)
  }
  collectSessionAttachmentOwnership(sessionId: string) {
    return withSharedSessionStorageAccess(() => collectSessionOwnership(this.getData(), sessionId))
  }

  iterateSessionAttachmentFacts(
    ...args: Parameters<SessionRepositoryPort['iterateSessionAttachmentFacts']>
  ): ReturnType<SessionRepositoryPort['iterateSessionAttachmentFacts']> {
    return this.getData().iterateSessionAttachmentFacts(...args)
  }
  /** Read obsolete settings only at the legacy upgrade input boundary. */
  async readUpgradeSessionHeader(id: string): Promise<SessionHeader | null> {
    await this.records.initialize()
    const rows = this.createRowStore()
    await rows.initialize()
    if ((await rows.readCommit(id))?.record.rowAuthority === 1) return (await this.getSessionHeader(id))?.header ?? null
    const record = await this.records.getRecord(id)
    if (!record) return null
    if ('storageFormat' in record && record.storageFormat === 'rows') {
      return (await this.getSessionHeader(id))?.header ?? null
    }
    const {
      messages: _messages,
      threads: _threads,
      messageForksHash: _forks,
      compactionPoints: _points,
      ...header
    } = record as Session
    return header
  }

  upgradeLegacySessionSettings(id: string, settings: NonNullable<SessionHeader['settings']>): Promise<void> {
    return this.getData().upgradeLegacySessionSettings(id, settings)
  }

  /** Retain an older file's split input until row publication. Existing records remain authoritative. */
  async storeLegacyUpgradeInput(source: Session): Promise<void> {
    await this.withBackupStorageAccess(async () => {
      const rows = this.createRowStore()
      if ((await rows.hasRows(source.id)) || (await this.records.getRecord(source.id))) return
      await this.records.setRecord(source)
    })
  }

  readonly meta: SessionMetaRepositoryPort

  private readonly backupDataStorage: CurrentSessionDataStorage
  private readonly records: CurrentSessionRecordStore
  private readonly createRowStore: () => SessionRowStorePort
  private readonly createMetaStorage: () => SessionMetaRepositoryPort
  private data: RowBackedSessionRepository | null = null
  private readonly projectionRepairs = new Set<string>()
  private foregroundOperations = 0

  hasForegroundSessionWork(): boolean {
    return this.foregroundOperations > 0
  }

  private async withForegroundSessionWork<T>(read: () => Promise<T>): Promise<T> {
    this.foregroundOperations++
    try {
      return await read()
    } finally {
      this.foregroundOperations--
    }
  }

  constructor(options: CurrentSessionRepositoryOptions = {}) {
    this.backupDataStorage = options.dataStorage ?? storage
    this.records = new CurrentSessionRecordStore(options.dataStorage ?? storage)
    this.createRowStore = () => options.rowStore ?? platform.getSessionRowStore()
    this.createMetaStorage = () => options.metaStorage ?? platform.getSessionMetaStorage()
    this.meta = new CurrentSessionMetaRepository(this.createMetaStorage)
  }

  private getData(): RowBackedSessionRepository {
    if (!this.data) {
      const rows = this.createRowStore()
      if (!('readBranchMessagesPage' in rows && 'iterateBackupRows' in rows && 'beginBackupRestore' in rows)) {
        throw new Error('Session row reads and backup are unavailable')
      }
      this.data = new RowBackedSessionRepository({
        records: this.records,
        rows: rows as RepositoryRows,
        backup: rows as SessionRowStorePort & BackupSessionStore,
        writes: new SessionRowWriteQueue((sessionId, action) =>
          withSharedSessionStorageAccess(async () => {
            if (typeof navigator === 'undefined' || !navigator.locks) return action()
            return await navigator.locks.request(
              `chatbox-session-storage:${sessionId}`,
              { mode: 'exclusive' },
              async () => await action()
            )
          })
        ),
        onRecordProjectionError: (sessionId, error) => {
          this.projectionRepairs.add(sessionId)
          log.warn(`session ${sessionId} record projection needs repair`, error)
          Sentry.captureException(error, { tags: { operation: 'session-record-projection' }, extra: { sessionId } })
        },
      })
    }
    return this.data
  }

  initialize(): Promise<void> {
    return normalizeRepositoryError('initialize', async () => {
      await this.meta.initialize()
      await this.getData().initialize()
    })
  }

  getSessionHeader(
    ...args: Parameters<SessionRepositoryPort['getSessionHeader']>
  ): ReturnType<SessionRepositoryPort['getSessionHeader']> {
    return this.withForegroundSessionWork(() => this.getData().getSessionHeader(...args))
  }

  iterateSessionArtifactMarkdown(
    ...args: Parameters<SessionRepositoryPort['iterateSessionArtifactMarkdown']>
  ): ReturnType<SessionRepositoryPort['iterateSessionArtifactMarkdown']> {
    return this.getData().iterateSessionArtifactMarkdown(...args)
  }

  getSessionContextSource(
    ...args: Parameters<SessionRepositoryPort['getSessionContextSource']>
  ): ReturnType<SessionRepositoryPort['getSessionContextSource']> {
    return this.withForegroundSessionWork(() => this.getData().getSessionContextSource(...args))
  }

  readSessionConversationState(
    ...args: Parameters<SessionRepositoryPort['readSessionConversationState']>
  ): ReturnType<SessionRepositoryPort['readSessionConversationState']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionConversationState(...args))
  }

  readSessionNamingMessages(
    ...args: Parameters<SessionRepositoryPort['readSessionNamingMessages']>
  ): ReturnType<SessionRepositoryPort['readSessionNamingMessages']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionNamingMessages(...args))
  }

  readSessionMessages(
    ...args: Parameters<SessionRepositoryPort['readSessionMessages']>
  ): ReturnType<SessionRepositoryPort['readSessionMessages']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionMessages(...args))
  }

  readPreviousUserMessage(
    ...args: Parameters<SessionRepositoryPort['readPreviousUserMessage']>
  ): ReturnType<SessionRepositoryPort['readPreviousUserMessage']> {
    return this.withForegroundSessionWork(() => this.getData().readPreviousUserMessage(...args))
  }

  readSessionPromptCacheDecision(
    ...args: Parameters<SessionRepositoryPort['readSessionPromptCacheDecision']>
  ): ReturnType<SessionRepositoryPort['readSessionPromptCacheDecision']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionPromptCacheDecision(...args))
  }

  iterateSessionResourceReferences(sessionId: string, signal?: AbortSignal) {
    return this.getData().iterateSessionResourceReferences(sessionId, signal)
  }

  readSessionGeneratingMessageIds(sessionId: string): Promise<string[]> {
    return this.getData().readSessionGeneratingMessageIds(sessionId)
  }

  readSessionGenerationControl(
    ...args: Parameters<SessionRepositoryPort['readSessionGenerationControl']>
  ): ReturnType<SessionRepositoryPort['readSessionGenerationControl']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionGenerationControl(...args))
  }

  readSessionSearchWindow(
    ...args: Parameters<SessionRepositoryPort['readSessionSearchWindow']>
  ): ReturnType<SessionRepositoryPort['readSessionSearchWindow']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionSearchWindow(...args))
  }

  readSessionSearchCandidates(
    ...args: Parameters<SessionRepositoryPort['readSessionSearchCandidates']>
  ): ReturnType<SessionRepositoryPort['readSessionSearchCandidates']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionSearchCandidates(...args))
  }

  readSessionTranscriptWindow(
    ...args: Parameters<SessionRepositoryPort['readSessionTranscriptWindow']>
  ): ReturnType<SessionRepositoryPort['readSessionTranscriptWindow']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionTranscriptWindow(...args))
  }

  readSessionBranchPreview(
    ...args: Parameters<SessionRepositoryPort['readSessionBranchPreview']>
  ): ReturnType<SessionRepositoryPort['readSessionBranchPreview']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionBranchPreview(...args))
  }

  readSessionBranchMessagesPage(
    ...args: Parameters<SessionRepositoryPort['readSessionBranchMessagesPage']>
  ): ReturnType<SessionRepositoryPort['readSessionBranchMessagesPage']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionBranchMessagesPage(...args))
  }

  readSessionNavigationPage(
    ...args: Parameters<SessionRepositoryPort['readSessionNavigationPage']>
  ): ReturnType<SessionRepositoryPort['readSessionNavigationPage']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionNavigationPage(...args))
  }

  repairSessionNavigationProjections(
    ...args: Parameters<SessionRepositoryPort['repairSessionNavigationProjections']>
  ): ReturnType<SessionRepositoryPort['repairSessionNavigationProjections']> {
    return this.getData().repairSessionNavigationProjections(...args)
  }

  readSessionThread(
    ...args: Parameters<SessionRepositoryPort['readSessionThread']>
  ): ReturnType<SessionRepositoryPort['readSessionThread']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionThread(...args))
  }

  readSessionThreadSummariesPage(
    ...args: Parameters<SessionRepositoryPort['readSessionThreadSummariesPage']>
  ): ReturnType<SessionRepositoryPort['readSessionThreadSummariesPage']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionThreadSummariesPage(...args))
  }

  readSessionForkOptionsPage(
    ...args: Parameters<SessionRepositoryPort['readSessionForkOptionsPage']>
  ): ReturnType<SessionRepositoryPort['readSessionForkOptionsPage']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionForkOptionsPage(...args))
  }

  acceptSessionTokenCacheResults(
    ...args: Parameters<SessionRepositoryPort['acceptSessionTokenCacheResults']>
  ): ReturnType<SessionRepositoryPort['acceptSessionTokenCacheResults']> {
    return this.getData().acceptSessionTokenCacheResults(...args)
  }

  createSessionTokenPlan(
    ...args: Parameters<SessionRepositoryPort['createSessionTokenPlan']>
  ): ReturnType<SessionRepositoryPort['createSessionTokenPlan']> {
    return this.withForegroundSessionWork(() => this.getData().createSessionTokenPlan(...args))
  }

  readSessionTokenPage(
    ...args: Parameters<SessionRepositoryPort['readSessionTokenPage']>
  ): ReturnType<SessionRepositoryPort['readSessionTokenPage']> {
    return this.withForegroundSessionWork(() => this.getData().readSessionTokenPage(...args))
  }

  acceptSessionTextTokenResults(
    ...args: Parameters<SessionRepositoryPort['acceptSessionTextTokenResults']>
  ): ReturnType<SessionRepositoryPort['acceptSessionTextTokenResults']> {
    return this.getData().acceptSessionTextTokenResults(...args)
  }

  patchSessionMessageDerivedData(
    ...args: Parameters<SessionRepositoryPort['patchSessionMessageDerivedData']>
  ): ReturnType<SessionRepositoryPort['patchSessionMessageDerivedData']> {
    return this.getData().patchSessionMessageDerivedData(...args)
  }

  getCurrentThreadIdentity(
    ...args: Parameters<SessionRepositoryPort['getCurrentThreadIdentity']>
  ): ReturnType<SessionRepositoryPort['getCurrentThreadIdentity']> {
    return this.withForegroundSessionWork(() => this.getData().getCurrentThreadIdentity(...args))
  }

  copySessionRows(
    ...args: Parameters<SessionRepositoryPort['copySessionRows']>
  ): ReturnType<SessionRepositoryPort['copySessionRows']> {
    return this.withForegroundSessionWork(() => this.getData().copySessionRows(...args))
  }

  copySessionThreadRows(
    ...args: Parameters<SessionRepositoryPort['copySessionThreadRows']>
  ): ReturnType<SessionRepositoryPort['copySessionThreadRows']> {
    return this.withForegroundSessionWork(() => this.getData().copySessionThreadRows(...args))
  }

  createSessionRows(
    ...args: Parameters<SessionRepositoryPort['createSessionRows']>
  ): ReturnType<SessionRepositoryPort['createSessionRows']> {
    return this.withForegroundSessionWork(() => this.getData().createSessionRows(...args))
  }

  executeSessionCommand(
    ...args: Parameters<SessionRepositoryPort['executeSessionCommand']>
  ): ReturnType<SessionRepositoryPort['executeSessionCommand']> {
    return this.withForegroundSessionWork(() => this.getData().executeSessionCommand(...args))
  }

  deleteSession(
    ...args: Parameters<SessionRepositoryPort['deleteSession']>
  ): ReturnType<SessionRepositoryPort['deleteSession']> {
    return this.withForegroundSessionWork(() => this.getData().deleteSession(...args))
  }

  repairSessionRecordProjection(
    ...args: Parameters<SessionRepositoryPort['repairSessionRecordProjection']>
  ): ReturnType<SessionRepositoryPort['repairSessionRecordProjection']> {
    return this.getData().repairSessionRecordProjection(...args)
  }

  projectLatestSession<T>(sessionId: string, project: (current: SessionHeaderRead | null) => Promise<T>): Promise<T> {
    return this.getData().projectLatestSession(sessionId, project)
  }

  projectSessionMetadata<T>(sessionId: string, project: () => Promise<T>): Promise<T> {
    return this.getData().projectSessionMetadata(sessionId, project)
  }

  getAllSessionIds(): Promise<string[]> {
    return normalizeRepositoryError('list-session-ids', () => this.getData().getAllSessionIds())
  }

  /** Lists only identities; each candidate is inspected in a separate idle tick. */
  listSessionMigrationCandidates(): Promise<SessionMigrationCandidate[]> {
    return normalizeRepositoryError('list-session-ids', async () => {
      const data = this.getData()
      await data.initialize()
      const recordIds = new Set(await this.records.listIds())
      return (await data.getAllSessionIds()).map((id) => ({ id, recordExists: recordIds.has(id) }))
    })
  }

  requiresSessionMigration(candidate: SessionMigrationCandidate): Promise<boolean> {
    return normalizeRepositoryError(
      'list-session-ids',
      async () => {
        const commit = await this.createRowStore().readCommit(candidate.id)
        return (
          commit?.record.rowAuthority !== 1 ||
          commit.record.rowFormatVersion !== 3 ||
          !candidate.recordExists ||
          this.projectionRepairs.has(candidate.id)
        )
      },
      candidate.id
    )
  }

  /** Publishes verified rows and repairs their independent list/record projections. */
  migrateSession(id: string): Promise<SessionMigrationOutcome> {
    return normalizeRepositoryError(
      'get-session',
      async () => {
        const data = this.getData()
        await data.initialize()
        const previous = await this.createRowStore().readCommit(id)
        if (!(await data.getSessionHeader(id))) return 'missing'
        await data.repairSessionRecordProjection(id)
        this.projectionRepairs.delete(id)
        await data.projectLatestSession(id, async (read) => {
          if (!read) return
          const meta = this.createMetaStorage()
          if (await meta.getById(id)) return
          const now = Date.now()
          await meta.create(createSessionMetaRecord(read.header, now, now, read.summary.pausedMessageCount > 0))
        })
        return previous?.record.rowAuthority === 1 && previous.record.rowFormatVersion === 3 ? 'already' : 'migrated'
      },
      id
    )
  }
}
