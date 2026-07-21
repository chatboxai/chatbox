import type { Session, SessionMeta, SessionMetaRecord } from '@shared/types'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import {
  createSessionWithId,
  deleteSession,
  getMetaStorage,
  listAllSessionsMeta,
  refreshSessionListCache,
  updateSession,
} from '@/stores/chatStore'
import { settingsStore } from '@/stores/settingsStore'
import { migrateSession } from '@/utils/session-utils'
import type { WebDAVSyncDeps } from './service'

function isChatSessionLike(item: Pick<Session, 'type'> | Pick<SessionMetaRecord, 'type'>): boolean {
  return item.type === 'chat' || !item.type
}

export async function listLocalSyncSessions(): Promise<Session[]> {
  const metas = (await listAllSessionsMeta()).filter(isChatSessionLike)
  const sessions = await Promise.all(
    metas.map((meta) => storage.getItem<Session | null>(StorageKeyGenerator.session(meta.id), null))
  )
  return sessions
    .filter((session): session is Session => {
      if (!session) {
        return false
      }
      return isChatSessionLike(session)
    })
    .map((session) => migrateSession(session))
}

export async function listLocalSyncMetas(): Promise<SessionMetaRecord[]> {
  return (await listAllSessionsMeta()).filter(isChatSessionLike)
}

export async function createSyncSession(session: Session, meta: SessionMetaRecord): Promise<void> {
  await createSessionWithId(session, meta)
}

export async function deleteSyncSession(sessionId: string): Promise<void> {
  await deleteSession(sessionId)
}

function sessionMetadataPatch(session: SessionMeta): Omit<SessionMeta, 'id'> {
  return {
    name: session.name,
    type: session.type,
    starred: session.starred,
    hidden: session.hidden,
    assistantAvatarKey: session.assistantAvatarKey,
    picUrl: session.picUrl,
    backgroundImage: session.backgroundImage,
  }
}

export async function updateSyncSessionMetadata(
  sessionId: string,
  patch: Omit<SessionMeta, 'id'>
): Promise<Omit<SessionMeta, 'id'>> {
  let previous: Omit<SessionMeta, 'id'> | undefined
  try {
    await updateSession(sessionId, (current) => {
      if (!current) {
        throw new Error(`Session ${sessionId} not found`)
      }
      previous = sessionMetadataPatch(current)
      return { ...current, ...patch }
    })
  } catch (error) {
    if (previous) {
      try {
        await updateSession(sessionId, previous)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Failed to update synced session ${sessionId} and restore its metadata`,
          { cause: error }
        )
      }
    }
    throw error
  }

  if (!previous) {
    throw new Error(`Session ${sessionId} not found`)
  }
  return previous
}

export async function saveSyncMetas(metas: SessionMetaRecord[]): Promise<void> {
  if (metas.length === 0) {
    return
  }
  const metaStorage = await getMetaStorage()
  const previous = await Promise.all(metas.map((meta) => metaStorage.getById(meta.id)))
  try {
    await metaStorage.createMany(metas)
    await refreshSessionListCache()
  } catch (error) {
    const previousRecords = previous.filter((meta): meta is SessionMetaRecord => meta !== null)
    const newIds = metas.filter((_, index) => previous[index] === null).map((meta) => meta.id)
    try {
      await metaStorage.createMany(previousRecords)
      await metaStorage.deleteMany(newIds)
      await refreshSessionListCache()
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Failed to save synced metadata and restore previous records', {
        cause: error,
      })
    }
    throw error
  }
}

export function updateSyncLastSyncedAt(isoDate: string) {
  settingsStore.getState().setSettings((settings) => {
    settings.sync.lastSyncedAt = isoDate
  })
}

export function createDefaultWebDAVSyncDeps(): WebDAVSyncDeps {
  return {
    platform,
    listLocalSessions: listLocalSyncSessions,
    listLocalMetas: listLocalSyncMetas,
    createSession: createSyncSession,
    updateSessionMetadata: updateSyncSessionMetadata,
    deleteSession: deleteSyncSession,
    saveMetas: saveSyncMetas,
    updateLastSyncedAt: updateSyncLastSyncedAt,
  }
}
