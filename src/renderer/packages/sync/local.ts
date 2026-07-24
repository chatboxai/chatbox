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
import type { SyncMetadataOrder, SyncMetadataUndo, WebDAVSyncDeps } from './service'

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

function valuesForPatchedMetadata(
  session: SessionMeta,
  patch: Partial<Omit<SessionMeta, 'id'>>
): Partial<Omit<SessionMeta, 'id'>> {
  const source = sessionMetadataPatch(session) as Record<string, unknown>
  const previous: Record<string, unknown> = {}
  for (const key of Object.keys(patch)) {
    previous[key] = source[key]
  }
  return previous as Partial<Omit<SessionMeta, 'id'>>
}

function conditionalSessionRestore(
  session: Session,
  undo: SyncMetadataUndo
): Partial<Omit<SessionMeta, 'id'>> {
  const current = sessionMetadataPatch(session) as Record<string, unknown>
  const applied = undo.appliedSession as Record<string, unknown> | undefined
  const previous = undo.previousSession as Record<string, unknown> | undefined
  const restore: Record<string, unknown> = {}
  if (!applied || !previous) {
    return restore as Partial<Omit<SessionMeta, 'id'>>
  }
  for (const key of Object.keys(applied)) {
    if (Object.is(current[key], applied[key])) {
      restore[key] = previous[key]
    }
  }
  return restore as Partial<Omit<SessionMeta, 'id'>>
}

export async function restoreSyncSessionMetadata(sessionId: string, undo: SyncMetadataUndo): Promise<void> {
  if (undo.appliedSession && undo.previousSession) {
    await updateSession(sessionId, (current) => {
      if (!current) {
        throw new Error(`Session ${sessionId} not found`)
      }
      return { ...current, ...conditionalSessionRestore(current, undo) }
    })
  }

  if (undo.appliedOrder && undo.previousOrder) {
    const metaStorage = await getMetaStorage()
    const current = await metaStorage.getById(sessionId)
    if (!current) {
      throw new Error(`Session metadata ${sessionId} not found`)
    }
    const restore: Partial<SyncMetadataOrder> = {}
    if (current.sortOrder === undo.appliedOrder.sortOrder) {
      restore.sortOrder = undo.previousOrder.sortOrder
    }
    if (current.createdAt === undo.appliedOrder.createdAt) {
      restore.createdAt = undo.previousOrder.createdAt
    }
    if (Object.keys(restore).length > 0) {
      const restored = await metaStorage.update(sessionId, restore)
      if (!restored) {
        throw new Error(`Session metadata ${sessionId} not found`)
      }
      await refreshSessionListCache()
    }
  }
}

export async function updateSyncSessionMetadata(
  sessionId: string,
  patch: Partial<Omit<SessionMeta, 'id'>> | undefined,
  order: SyncMetadataOrder | undefined = undefined
): Promise<SyncMetadataUndo> {
  const undo: SyncMetadataUndo = {}
  try {
    if (patch && Object.keys(patch).length > 0) {
      await updateSession(sessionId, (current) => {
        if (!current) {
          throw new Error(`Session ${sessionId} not found`)
        }
        undo.previousSession = valuesForPatchedMetadata(current, patch)
        undo.appliedSession = { ...patch }
        return { ...current, ...patch }
      })
    }

    if (order) {
      const metaStorage = await getMetaStorage()
      const current = await metaStorage.getById(sessionId)
      if (!current) {
        throw new Error(`Session metadata ${sessionId} not found`)
      }
      undo.previousOrder = { sortOrder: current.sortOrder, createdAt: current.createdAt }
      undo.appliedOrder = { ...order }
      const updated = await metaStorage.update(sessionId, order)
      if (!updated) {
        throw new Error(`Session metadata ${sessionId} not found`)
      }
      await refreshSessionListCache()
    }
  } catch (error) {
    if (undo.appliedSession || undo.appliedOrder) {
      try {
        await restoreSyncSessionMetadata(sessionId, undo)
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

  return undo
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

export function getSyncLastSeenSnapshot(): { endpoint: string; etag?: string } | undefined {
  const sync = settingsStore.getState().sync
  if (!sync?.lastSeenEndpoint) {
    return undefined
  }
  return { endpoint: sync.lastSeenEndpoint, etag: sync.lastSeenETag }
}

export function setSyncLastSeenSnapshot(seen: { endpoint: string; etag?: string }) {
  settingsStore.getState().setSettings((settings) => {
    settings.sync.lastSeenEndpoint = seen.endpoint
    settings.sync.lastSeenETag = seen.etag
  })
}

export function createDefaultWebDAVSyncDeps(): WebDAVSyncDeps {
  return {
    platform,
    listLocalSessions: listLocalSyncSessions,
    listLocalMetas: listLocalSyncMetas,
    createSession: createSyncSession,
    updateSessionMetadata: updateSyncSessionMetadata,
    restoreSessionMetadata: restoreSyncSessionMetadata,
    deleteSession: deleteSyncSession,
    updateLastSyncedAt: updateSyncLastSyncedAt,
    getLastSeenSnapshot: getSyncLastSeenSnapshot,
    setLastSeenSnapshot: setSyncLastSeenSnapshot,
  }
}
