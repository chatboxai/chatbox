import type { Session, SessionMetaRecord, Settings } from '@shared/types'
import { SessionMetaRecordSchema, SessionSchema } from '@shared/types/session'
import { z } from 'zod'
import { migrateSession } from '@/utils/session-utils'
import { decryptJsonEnvelope, encryptJsonEnvelope } from './crypto'
import { createSyncSnapshot, mergeRemoteSnapshot } from './snapshot'
import type { SyncCryptoEnvelope, SyncSnapshot, WebDAVRequest, WebDAVResponse } from './types'
import { buildBasicAuthHeader, joinWebDAVUrl, requestWebDAV, SYNC_COLLECTION_PATH, SYNC_SNAPSHOT_PATH } from './webdav'

const RawSyncSnapshotSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  deviceName: z.string(),
  sessions: z.array(z.unknown()),
  metas: z.array(SessionMetaRecordSchema),
})

type SyncPlatform = {
  getDeviceName?: () => Promise<string>
  webdavRequest?: (request: WebDAVRequest, baseUrl: string) => Promise<WebDAVResponse>
}

export type WebDAVSyncDeps = {
  platform: SyncPlatform
  listLocalSessions: () => Promise<Session[]>
  listLocalMetas: () => Promise<SessionMetaRecord[]>
  saveSession: (session: Session) => Promise<void>
  deleteSession?: (sessionId: string) => Promise<void>
  saveMetas: (metas: SessionMetaRecord[]) => Promise<void>
  updateLastSyncedAt: (isoDate: string) => Promise<void> | void
  createId: () => string
  now?: () => number
}

export type UploadWebDAVSnapshotResult = {
  uploaded: number
  lastSyncedAt: string
}

export type DownloadWebDAVSnapshotResult = {
  imported: number
  conflicts: number
  saved: number
  lastSyncedAt?: string
  remoteMissing?: boolean
}

function getWebDAVSettings(settings: Settings) {
  const sync = settings.sync
  if (!sync || sync.provider !== 'webdav') {
    throw new Error('WebDAV sync is not configured')
  }
  const { url, username, password, syncPassword } = sync.webdav
  if (!url.trim()) {
    throw new Error('WebDAV URL is required')
  }
  if (new URL(url).protocol !== 'https:') {
    throw new Error('WebDAV URL must use HTTPS')
  }
  if (!username.trim()) {
    throw new Error('WebDAV username is required')
  }
  if (!password) {
    throw new Error('WebDAV password is required')
  }
  if (!syncPassword) {
    throw new Error('Sync encryption password is required')
  }
  return sync.webdav
}

function authHeaders(settings: Settings): Record<string, string> {
  const webdav = getWebDAVSettings(settings)
  return {
    Authorization: buildBasicAuthHeader(webdav.username, webdav.password),
  }
}

function parseSyncSnapshot(value: unknown): SyncSnapshot {
  const result = RawSyncSnapshotSchema.safeParse(value)
  if (!result.success) {
    throw new Error('Invalid sync snapshot')
  }
  const sessions = z
    .array(SessionSchema)
    .safeParse(result.data.sessions.map((session) => migrateSession(session as Session)))
  if (!sessions.success) {
    throw new Error('Invalid sync snapshot')
  }
  return {
    ...result.data,
    sessions: sessions.data,
  }
}

function snapshotUrl(settings: Settings): string {
  return joinWebDAVUrl(getWebDAVSettings(settings).url, SYNC_SNAPSHOT_PATH)
}

function collectionUrls(settings: Settings): string[] {
  const webdav = getWebDAVSettings(settings)
  return ['ChatboxSync/', SYNC_COLLECTION_PATH].map((path) => joinWebDAVUrl(webdav.url, path))
}

function assertSuccess(response: WebDAVResponse, action: string, okStatuses: number[]) {
  if (!okStatuses.includes(response.status)) {
    throw new Error(`${action} failed with HTTP ${response.status}${response.body ? `: ${response.body}` : ''}`)
  }
}

async function ensureWebDAVCollections(settings: Settings, platform: SyncPlatform) {
  const webdav = getWebDAVSettings(settings)
  const headers = authHeaders(settings)
  for (const url of collectionUrls(settings)) {
    const response = await requestWebDAV(platform, webdav.url, {
      url,
      method: 'MKCOL',
      headers,
    })
    assertSuccess(response, 'Create WebDAV sync directory', [200, 201, 405])
  }
}

async function downloadWebDAVSnapshot(settings: Settings, platform: SyncPlatform): Promise<SyncSnapshot | undefined> {
  const webdav = getWebDAVSettings(settings)
  const response = await requestWebDAV(platform, webdav.url, {
    url: snapshotUrl(settings),
    method: 'GET',
    headers: authHeaders(settings),
  })

  if (response.status === 404) {
    return undefined
  }
  assertSuccess(response, 'Download WebDAV sync snapshot', [200])

  const envelope = JSON.parse(response.body) as SyncCryptoEnvelope
  return parseSyncSnapshot(await decryptJsonEnvelope(envelope, webdav.syncPassword))
}

export async function testWebDAVConnection(settings: Settings, deps: Pick<WebDAVSyncDeps, 'platform'>): Promise<void> {
  const webdav = getWebDAVSettings(settings)
  await ensureWebDAVCollections(settings, deps.platform)
  const response = await requestWebDAV(deps.platform, webdav.url, {
    url: snapshotUrl(settings),
    method: 'PROPFIND',
    headers: {
      ...authHeaders(settings),
      Depth: '0',
    },
  })
  assertSuccess(response, 'Check WebDAV snapshot', [200, 207, 404])
}

export async function uploadWebDAVSnapshot(
  settings: Settings,
  deps: WebDAVSyncDeps
): Promise<UploadWebDAVSnapshotResult> {
  const webdav = getWebDAVSettings(settings)
  await ensureWebDAVCollections(settings, deps.platform)

  const [sessions, metas, deviceName] = await Promise.all([
    deps.listLocalSessions(),
    deps.listLocalMetas(),
    deps.platform.getDeviceName?.() ?? Promise.resolve('Unknown device'),
  ])
  const lastSyncedAt = new Date((deps.now ?? Date.now)()).toISOString()
  const localSnapshot = createSyncSnapshot({
    sessions,
    metas,
    deviceName,
    exportedAt: lastSyncedAt,
  })
  const remoteSnapshot = await downloadWebDAVSnapshot(settings, deps.platform)
  const mergeResult = remoteSnapshot
    ? mergeRemoteSnapshot({
        localSessions: localSnapshot.sessions,
        localMetas: localSnapshot.metas,
        remote: remoteSnapshot,
        now: (deps.now ?? Date.now)(),
        createId: deps.createId,
      })
    : undefined
  const snapshot = mergeResult
    ? createSyncSnapshot({
        sessions: [...localSnapshot.sessions, ...mergeResult.sessionsToSave],
        metas: [...localSnapshot.metas, ...mergeResult.metasToSave],
        deviceName,
        exportedAt: lastSyncedAt,
      })
    : localSnapshot
  const envelope = await encryptJsonEnvelope(snapshot, webdav.syncPassword)
  const response = await requestWebDAV(deps.platform, webdav.url, {
    url: snapshotUrl(settings),
    method: 'PUT',
    headers: {
      ...authHeaders(settings),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(envelope),
  })
  assertSuccess(response, 'Upload WebDAV sync snapshot', [200, 201, 204])
  await deps.updateLastSyncedAt(lastSyncedAt)
  return {
    uploaded: snapshot.sessions.length,
    lastSyncedAt,
  }
}

export async function downloadAndMergeWebDAVSnapshot(
  settings: Settings,
  deps: WebDAVSyncDeps
): Promise<DownloadWebDAVSnapshotResult> {
  const remote = await downloadWebDAVSnapshot(settings, deps.platform)
  if (!remote) {
    return {
      imported: 0,
      conflicts: 0,
      saved: 0,
      remoteMissing: true,
    }
  }

  const [localSessions, localMetas] = await Promise.all([deps.listLocalSessions(), deps.listLocalMetas()])
  const result = mergeRemoteSnapshot({
    localSessions,
    localMetas,
    remote,
    now: (deps.now ?? Date.now)(),
    createId: deps.createId,
    preferRemoteMetadata: true,
  })

  const savedSessionIds: string[] = []
  try {
    for (const session of result.sessionsToSave) {
      await deps.saveSession(session)
      savedSessionIds.push(session.id)
    }
    if (result.metasToSave.length > 0) {
      await deps.saveMetas(result.metasToSave)
    }
  } catch (error) {
    if (deps.deleteSession) {
      await Promise.allSettled(savedSessionIds.map((id) => deps.deleteSession?.(id)))
    }
    throw error
  }

  const lastSyncedAt = new Date((deps.now ?? Date.now)()).toISOString()
  await deps.updateLastSyncedAt(lastSyncedAt)

  return {
    imported: result.imported,
    conflicts: result.conflicts,
    saved: result.sessionsToSave.length,
    lastSyncedAt,
  }
}
