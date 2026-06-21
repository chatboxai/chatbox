import type { Session, SessionMetaRecord } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { getMetaStorage, listAllSessionsMeta, refreshSessionListCache } from '@/stores/chatStore'
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

export async function saveSyncSession(session: Session): Promise<void> {
  await storage.setItemNow(StorageKeyGenerator.session(session.id), session)
}

export async function deleteSyncSession(sessionId: string): Promise<void> {
  await storage.removeItem(StorageKeyGenerator.session(sessionId))
}

export async function saveSyncMetas(metas: SessionMetaRecord[]): Promise<void> {
  if (metas.length === 0) {
    return
  }
  const metaStorage = await getMetaStorage()
  await metaStorage.createMany(metas)
  await refreshSessionListCache()
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
    saveSession: saveSyncSession,
    deleteSession: deleteSyncSession,
    saveMetas: saveSyncMetas,
    updateLastSyncedAt: updateSyncLastSyncedAt,
    createId: uuidv4,
  }
}
