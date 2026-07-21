import type { Session, SessionMeta, SessionMetaRecord } from '@shared/types'

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
  createConflictId?: (sourceSessionId: string, contentFingerprint: string) => string
  preferRemoteMetadata?: boolean
}

export type SyncSessionChange =
  | {
      kind: 'create'
      session: Session
    }
  | {
      kind: 'update-metadata'
      sessionId: string
      patch: Omit<SessionMeta, 'id'>
    }

export type MergeRemoteSnapshotResult = {
  sessionChanges: SyncSessionChange[]
  metasToSave: SessionMetaRecord[]
  imported: number
  conflicts: number
}
