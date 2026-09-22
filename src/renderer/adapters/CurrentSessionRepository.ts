import { RowBackedSessionRepository, type SessionMigrationOutcome } from '@chatbox/core/application/session'
import {
  BackupOperationBusyError,
  type BackupSessionStore,
  recordBackupSource,
  throwIfAborted,
} from '@chatbox/core/backup'
import type { SessionTextTokenResult, SessionTextTokenWriteResult } from '@chatbox/core/ports'
import {
  type SessionContextRequest,
  type SessionContextSource,
  type SessionDataWriteOptions,
  type SessionMessageDerivedPatch,
  type SessionMessageDerivedWriteResult,
  type SessionMessagesRequest,
  type SessionMessagesSource,
  type SessionMessageWindow,
  type SessionMessageWindowRequest,
  type SessionMetaRepositoryPort,
  type SessionReadModel,
  SessionRepositoryError,
  type SessionRepositoryOperation,
  type SessionRepositoryPort,
  type SessionRowStorePort,
  SessionWriteConflictError,
} from '@chatbox/core/ports'
import * as Sentry from '@sentry/react'
import type { Session, SessionMetaPage, SessionMetaRecord } from '@shared/types'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import storage from '@/storage'
import { rendererBackupSessionStore } from './backup-session-store'
import { type CurrentSessionDataStorage, CurrentSessionRecordStore } from './CurrentSessionRecordStore'
import { collectSessionOwnership } from './session-ownership'

export type { CurrentSessionDataStorage } from './CurrentSessionRecordStore'

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

/**
 * A session whose encoding does not round-trip keeps working in its legacy
 * whole-session form, so this is a compatibility signal rather than a failure.
 */
function reportMigrationSkipped(sessionId: string, reason: string): void {
  log.warn(`session ${sessionId} was not converted to message rows: ${reason}`)
  Sentry.addBreadcrumb({
    category: 'session-storage',
    level: 'warning',
    message: `session row migration skipped: ${reason}`,
    data: { sessionId, reason },
  })
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
      error instanceof BackupOperationBusyError
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

  getPage(cursor: number, limit?: number): Promise<SessionMetaPage> {
    return normalizeRepositoryError('list-meta-page', () => this.getBackend().getPage(cursor, limit))
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
    action: (
      readSession: (id: string) => Promise<Session | null>,
      metaStorage: SessionMetaRepositoryPort,
      backupStore?: BackupSessionStore
    ) => Promise<Result>,
    signal?: AbortSignal
  ): Promise<Result> {
    return withExclusiveSessionStorageLock(async () => {
      const reader = new RowBackedSessionRepository({
        records: this.records,
        rows: this.createRowStore(),
        onMigrationSkipped: reportMigrationSkipped,
      })
      const metaStorage = this.createMetaStorage()
      await metaStorage.initialize()
      const rows = this.createRowStore()
      const supportsBackup = 'iterateBackupRows' in rows && 'beginBackupRestore' in rows
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
            const previous = await dataStorage.getItem<import('@chatbox/core/ports').StoredSessionRecord | null>(
              token,
              null
            )
            if (!previous) throw new Error('Backup recovery record is missing')
            await this.records.setRecord(previous)
          }
        },
        remove: (token: string) => dataStorage.removeItem(token),
      }
      const backupStore = supportsBackup
        ? rendererBackupSessionStore(rows as SessionRowStorePort & BackupSessionStore, this.records, snapshots, {
            listSessionIds: () => this.records.listIds(),
            open: dataStorage.openBackupValue ? (id) => dataStorage.openBackupValue!(`session:${id}`) : undefined,
            readValue: async (id) => {
              const record = await this.records.getRecord(id)
              if (!record || ('storageFormat' in record && record.storageFormat === 'rows')) return null
              return record as Session
            },
          })
        : undefined
      return action((id) => reader.getSession(id), metaStorage, backupStore)
    }, signal)
  }
  collectSessionAttachmentOwnership(sessionId: string) {
    return withSharedSessionStorageAccess(async () => {
      const rows = this.createRowStore()
      if (!('iterateBackupRows' in rows && 'beginBackupRestore' in rows)) {
        throw new Error('Bounded session ownership reads are unavailable')
      }
      const storage = this.backupDataStorage
      const source = recordBackupSource(rows as SessionRowStorePort & BackupSessionStore, this.records, {
        listSessionIds: () => this.records.listIds(),
        open: storage.openBackupValue ? (id) => storage.openBackupValue!(`session:${id}`) : undefined,
        readValue: async (id) => {
          const record = await this.records.getRecord(id)
          if (!record || ('storageFormat' in record && record.storageFormat === 'rows')) return null
          return record as Session
        },
      })
      // 孤立分支导致扫描不完整时必须抛错，让维护任务停止清理，不能退回旧行或空归属。
      return collectSessionOwnership(source, sessionId)
    })
  }
  getCompleteSessionSource(sessionId: string) {
    return this.getData().getCompleteSessionSource(sessionId)
  }
  acceptSessionTextTokenResults(
    sessionId: string,
    results: readonly SessionTextTokenResult[]
  ): Promise<SessionTextTokenWriteResult> {
    return this.getData().acceptSessionTextTokenResults(sessionId, results)
  }
  readonly meta: SessionMetaRepositoryPort

  private readonly backupDataStorage: CurrentSessionDataStorage
  private readonly records: CurrentSessionRecordStore
  private readonly createRowStore: () => SessionRowStorePort
  private readonly createMetaStorage: () => SessionMetaRepositoryPort
  private data: RowBackedSessionRepository | null = null

  constructor(options: CurrentSessionRepositoryOptions = {}) {
    this.backupDataStorage = options.dataStorage ?? storage
    this.records = new CurrentSessionRecordStore(options.dataStorage ?? storage)
    this.createRowStore = () => options.rowStore ?? platform.getSessionRowStore()
    this.createMetaStorage = () => options.metaStorage ?? platform.getSessionMetaStorage()
    this.meta = new CurrentSessionMetaRepository(this.createMetaStorage)
  }

  private getData(): RowBackedSessionRepository {
    if (!this.data) {
      this.data = new RowBackedSessionRepository({
        records: this.records,
        rows: this.createRowStore(),
        onMigrationSkipped: reportMigrationSkipped,
        serializeSessionOperation: async (sessionId, action) => {
          return withSharedSessionStorageAccess(async () => {
            if (typeof navigator === 'undefined' || !navigator.locks) return action()
            return navigator.locks.request(`chatbox-session-storage:${sessionId}`, { mode: 'exclusive' }, action)
          })
        },
      })
    }
    return this.data
  }

  initialize(): Promise<void> {
    return normalizeRepositoryError('initialize', async () => {
      await this.getData().initialize()
      await this.meta.initialize()
    })
  }

  getSession(id: string): Promise<Session | null> {
    return normalizeRepositoryError('get-session', () => this.getData().getSession(id), id)
  }

  getSessionReadModel(id: string): Promise<SessionReadModel | null> {
    return normalizeRepositoryError('get-session', () => this.getData().getSessionReadModel(id), id)
  }

  getSessionContextSource(request: SessionContextRequest): Promise<SessionContextSource | null> {
    return this.getData().getSessionContextSource(request)
  }

  readSessionMessages(request: SessionMessagesRequest): Promise<SessionMessagesSource | null> {
    return this.getData().readSessionMessages(request)
  }

  patchSessionMessageDerivedData(
    sessionId: string,
    patches: SessionMessageDerivedPatch[]
  ): Promise<SessionMessageDerivedWriteResult> {
    return this.getData().patchSessionMessageDerivedData(sessionId, patches)
  }

  readSessionMessageWindow(request: SessionMessageWindowRequest): Promise<SessionMessageWindow | null> {
    return this.getData().readSessionMessageWindow(request)
  }

  setSession(session: Session, options?: SessionDataWriteOptions): Promise<void> {
    return normalizeRepositoryError('set-session', () => this.getData().setSession(session, options), session.id)
  }

  deleteSession(id: string): Promise<void> {
    return normalizeRepositoryError('delete-session', () => this.getData().deleteSession(id), id)
  }

  getAllSessionIds(): Promise<string[]> {
    return normalizeRepositoryError('list-session-ids', () => this.getData().getAllSessionIds())
  }

  /** Ids of stored sessions that hold no rows yet. */
  listUnmigratedSessionIds(shouldSkip?: (id: string) => Promise<boolean>): Promise<string[]> {
    return normalizeRepositoryError('list-session-ids', () => this.getData().listUnmigratedSessionIds(shouldSkip))
  }

  /** Converts one stored session to rows, without caching anything about it. */
  migrateSession(id: string): Promise<SessionMigrationOutcome> {
    return normalizeRepositoryError('get-session', () => this.getData().migrateSession(id), id)
  }

  /** Must be called after a session's record or rows are written past this repository. */
  forgetBaseline(id: string): void {
    this.getData().forgetBaseline(id)
  }

  forgetAllBaselines(): void {
    this.getData().forgetAllBaselines()
  }
}
