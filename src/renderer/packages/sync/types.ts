import type { Session, SessionMetaRecord } from '@shared/types'
export type { WebDAVMethod, WebDAVRequest, WebDAVResponse } from '@shared/sync-webdav'

export type SyncProvider = 'webdav'

export type SyncCryptoEnvelope = {
  version: 1
  kdf: 'PBKDF2-SHA256'
  cipher: 'AES-GCM'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

export type SyncSnapshot = {
  version: 1
  exportedAt: string
  deviceName: string
  sessions: Session[]
  metas: SessionMetaRecord[]
}

export type MergeRemoteSnapshotInput = {
  localSessions: Session[]
  localMetas: SessionMetaRecord[]
  remote: SyncSnapshot
  now: number
  createId: () => string
}

export type MergeRemoteSnapshotResult = {
  sessionsToSave: Session[]
  metasToSave: SessionMetaRecord[]
  imported: number
  conflicts: number
}
