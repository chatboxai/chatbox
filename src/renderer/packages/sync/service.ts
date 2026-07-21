import type { Session, SessionMeta, SessionMetaRecord, Settings } from '@shared/types'
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

const MAX_UPLOAD_ATTEMPTS = 3
const HTTP_NOT_FOUND = 404
const HTTP_PRECONDITION_FAILED = 412

type SyncPlatform = {
  getDeviceName?: () => Promise<string>
  webdavRequest?: (request: WebDAVRequest, baseUrl: string) => Promise<WebDAVResponse>
}

type DownloadedWebDAVSnapshot = {
  snapshot?: SyncSnapshot
  etag?: string
}

export type WebDAVSyncDeps = {
  platform: SyncPlatform
  listLocalSessions: () => Promise<Session[]>
  listLocalMetas: () => Promise<SessionMetaRecord[]>
  createSession: (session: Session, meta: SessionMetaRecord) => Promise<void>
  updateSessionMetadata: (sessionId: string, patch: Omit<SessionMeta, 'id'>) => Promise<Omit<SessionMeta, 'id'>>
  deleteSession: (sessionId: string) => Promise<void>
  saveMetas: (metas: SessionMetaRecord[]) => Promise<void>
  updateLastSyncedAt: (isoDate: string) => Promise<void> | void
  createConflictId?: (sourceSessionId: string, contentFingerprint: string) => string
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

function responseHeader(headers: Record<string, string>, name: string): string | undefined {
  const normalizedName = name.toLowerCase()
  const entry = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === normalizedName)
  const value = entry?.[1].trim()
  return value ? value : undefined
}

function requireWebDAVSnapshotETag(remote: DownloadedWebDAVSnapshot): string {
  if (!remote.etag) {
    throw new Error('WebDAV server did not return an ETag for the sync snapshot; refusing to overwrite it')
  }
  return remote.etag
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

async function downloadWebDAVSnapshot(settings: Settings, platform: SyncPlatform): Promise<DownloadedWebDAVSnapshot> {
  const webdav = getWebDAVSettings(settings)
  const response = await requestWebDAV(platform, webdav.url, {
    url: snapshotUrl(settings),
    method: 'GET',
    headers: authHeaders(settings),
  })

  if (response.status === HTTP_NOT_FOUND) {
    return {}
  }
  assertSuccess(response, 'Download WebDAV sync snapshot', [200])

  const envelope = JSON.parse(response.body) as SyncCryptoEnvelope
  return {
    snapshot: parseSyncSnapshot(await decryptJsonEnvelope(envelope, webdav.syncPassword)),
    etag: responseHeader(response.headers, 'etag'),
  }
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
  const now = deps.now ?? Date.now
  await ensureWebDAVCollections(settings, deps.platform)

  const [sessions, metas, deviceName] = await Promise.all([
    deps.listLocalSessions(),
    deps.listLocalMetas(),
    deps.platform.getDeviceName?.() ?? Promise.resolve('Unknown device'),
  ])
  const lastSyncedAt = new Date(now()).toISOString()
  const localSnapshot = createSyncSnapshot({
    sessions,
    metas,
    deviceName,
    exportedAt: lastSyncedAt,
  })

  for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    const remote = await downloadWebDAVSnapshot(settings, deps.platform)
    const mergeResult = remote.snapshot
      ? mergeRemoteSnapshot({
          localSessions: localSnapshot.sessions,
          localMetas: localSnapshot.metas,
          remote: remote.snapshot,
          now: now(),
          createConflictId: deps.createConflictId,
        })
      : undefined
    const snapshot = mergeResult
      ? createSyncSnapshot({
          sessions: [
            ...localSnapshot.sessions,
            ...mergeResult.sessionChanges.filter((change) => change.kind === 'create').map((change) => change.session),
          ],
          metas: [...localSnapshot.metas, ...mergeResult.metasToSave],
          deviceName,
          exportedAt: lastSyncedAt,
        })
      : localSnapshot
    const preconditionHeaders: Record<string, string> = remote.snapshot
      ? { 'If-Match': requireWebDAVSnapshotETag(remote) }
      : { 'If-None-Match': '*' }
    const envelope = await encryptJsonEnvelope(snapshot, webdav.syncPassword)
    const response = await requestWebDAV(deps.platform, webdav.url, {
      url: snapshotUrl(settings),
      method: 'PUT',
      headers: {
        ...authHeaders(settings),
        'Content-Type': 'application/json',
        ...preconditionHeaders,
      },
      body: JSON.stringify(envelope),
    })

    if (response.status === HTTP_PRECONDITION_FAILED) {
      if (attempt < MAX_UPLOAD_ATTEMPTS - 1) {
        continue
      }
      throw new Error('Upload WebDAV sync snapshot failed because the remote snapshot changed during upload')
    }

    assertSuccess(response, 'Upload WebDAV sync snapshot', [200, 201, 204])
    await deps.updateLastSyncedAt(lastSyncedAt)
    return {
      uploaded: snapshot.sessions.length,
      lastSyncedAt,
    }
  }

  throw new Error('Upload WebDAV sync snapshot failed because the remote snapshot changed during upload')
}

export async function downloadAndMergeWebDAVSnapshot(
  settings: Settings,
  deps: WebDAVSyncDeps
): Promise<DownloadWebDAVSnapshotResult> {
  const remote = await downloadWebDAVSnapshot(settings, deps.platform)
  if (!remote.snapshot) {
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
    remote: remote.snapshot,
    now: (deps.now ?? Date.now)(),
    createConflictId: deps.createConflictId,
    preferRemoteMetadata: true,
  })

  const metaById = new Map(result.metasToSave.map((meta) => [meta.id, meta]))
  const createdSessionIds = new Set<string>()
  const undoOperations: Array<
    | { kind: 'delete-created'; sessionId: string }
    | { kind: 'restore-metadata'; sessionId: string; patch: Omit<SessionMeta, 'id'> }
  > = []
  try {
    for (const change of result.sessionChanges) {
      if (change.kind === 'create') {
        const meta = metaById.get(change.session.id)
        if (!meta) {
          throw new Error(`Missing metadata for synced session ${change.session.id}`)
        }
        await deps.createSession(change.session, meta)
        createdSessionIds.add(change.session.id)
        undoOperations.push({ kind: 'delete-created', sessionId: change.session.id })
      } else {
        const previous = await deps.updateSessionMetadata(change.sessionId, change.patch)
        undoOperations.push({ kind: 'restore-metadata', sessionId: change.sessionId, patch: previous })
      }
    }

    const existingMetasToSave = result.metasToSave.filter((meta) => !createdSessionIds.has(meta.id))
    if (existingMetasToSave.length > 0) {
      await deps.saveMetas(existingMetasToSave)
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const undo of undoOperations.reverse()) {
      try {
        if (undo.kind === 'delete-created') {
          await deps.deleteSession(undo.sessionId)
        } else {
          await deps.updateSessionMetadata(undo.sessionId, undo.patch)
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) {
      const message = error instanceof Error ? error.message : String(error)
      throw new AggregateError(
        [error, ...rollbackErrors],
        `WebDAV sync import failed: ${message}; restoring local data also failed`,
        { cause: error }
      )
    }
    throw error
  }

  const lastSyncedAt = new Date((deps.now ?? Date.now)()).toISOString()
  await deps.updateLastSyncedAt(lastSyncedAt)

  return {
    imported: result.imported,
    conflicts: result.conflicts,
    saved: result.sessionChanges.length,
    lastSyncedAt,
  }
}
