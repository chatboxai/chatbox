import {
  type SessionMetaRepositoryPort,
  SessionRepositoryError,
  type SessionRepositoryOperation,
  type SessionRepositoryPort,
} from '@chatbox/core/ports'
import type { Session, SessionMetaPage, SessionMetaRecord } from '@shared/types'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { migrateSession } from '@/utils/session-utils'

export interface CurrentSessionDataStorage {
  getItem<T>(key: string, initialValue: T): Promise<T>
  setItemNow<T>(key: string, value: T): Promise<void>
  removeItem(key: string): Promise<void>
  getAllKeys(): Promise<string[]>
}

export interface CurrentSessionRepositoryOptions {
  dataStorage?: CurrentSessionDataStorage
  metaStorage?: SessionMetaRepositoryPort
}

async function normalizeRepositoryError<T>(
  operation: SessionRepositoryOperation,
  action: () => Promise<T>,
  sessionId?: string
): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof SessionRepositoryError) throw error
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
    return normalizeRepositoryError('create-meta', () => this.getBackend().create(record), record.id)
  }

  createMany(records: SessionMetaRecord[]): Promise<void> {
    return normalizeRepositoryError('create-meta-many', () => this.getBackend().createMany(records))
  }

  update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null> {
    return normalizeRepositoryError('update-meta', () => this.getBackend().update(id, updates), id)
  }

  getById(id: string): Promise<SessionMetaRecord | null> {
    return normalizeRepositoryError('get-meta', () => this.getBackend().getById(id), id)
  }

  delete(id: string): Promise<void> {
    return normalizeRepositoryError('delete-meta', () => this.getBackend().delete(id), id)
  }

  deleteMany(ids: string[]): Promise<void> {
    return normalizeRepositoryError('delete-meta-many', () => this.getBackend().deleteMany(ids))
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
    return normalizeRepositoryError('clear-meta', () => this.getBackend().clear())
  }
}

/**
 * Session repository backed by the storage implementations used by the current
 * Renderer. It intentionally owns no QueryClient or UI side effects.
 */
export class CurrentSessionRepository implements SessionRepositoryPort {
  readonly meta: SessionMetaRepositoryPort

  private readonly dataStorage: CurrentSessionDataStorage

  constructor(options: CurrentSessionRepositoryOptions = {}) {
    this.dataStorage = options.dataStorage ?? storage
    this.meta = new CurrentSessionMetaRepository(() => options.metaStorage ?? platform.getSessionMetaStorage())
  }

  initialize(): Promise<void> {
    return this.meta.initialize()
  }

  getSession(id: string): Promise<Session | null> {
    return normalizeRepositoryError(
      'get-session',
      async () => {
        const value = await this.dataStorage.getItem<Session | null>(StorageKeyGenerator.session(id), null)
        return value ? migrateSession(value) : null
      },
      id
    )
  }

  setSession(session: Session): Promise<void> {
    return normalizeRepositoryError(
      'set-session',
      () => this.dataStorage.setItemNow(StorageKeyGenerator.session(session.id), session),
      session.id
    )
  }

  deleteSession(id: string): Promise<void> {
    return normalizeRepositoryError(
      'delete-session',
      () => this.dataStorage.removeItem(StorageKeyGenerator.session(id)),
      id
    )
  }

  getAllSessionIds(): Promise<string[]> {
    return normalizeRepositoryError('list-session-ids', async () => {
      const keys = await this.dataStorage.getAllKeys()
      return keys
        .filter((key) => key.startsWith('session:'))
        .map((key) => key.slice('session:'.length))
        .filter((id) => id.length > 0 && id !== 'undefined')
    })
  }
}
