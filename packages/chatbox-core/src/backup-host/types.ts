import type { BackupResourceRecord, BackupResourceSource, BackupWorkspace } from '../backup-v3/types'
import type { ByteSink } from '../io'
import type { KeyValueStoragePort } from '../ports/key-value-storage'
import type { SessionMetaRepositoryPort } from '../ports/session-repository'
import type { SessionRecordStorePort } from '../ports/session-record-store'
import type { SessionRowStorePort } from '../ports/session-row-store'
import type { Settings } from '../domain/settings'

/** Complete resource candidates are atomically published; cleanup only removes temporary files. */
export interface BackupHostResources {
  open(key: string): Promise<BackupResourceSource | null>
  stage(jobId: string, resource: BackupResourceRecord): Promise<ByteSink>
  publish(jobId: string, key: string): Promise<void>
  cleanup(jobId: string): Promise<void>
}

export interface BackupHostOptions {
  jobId: string
  workspace: BackupWorkspace
  storage: KeyValueStoragePort
  rows: SessionRowStorePort
  records: SessionRecordStorePort
  metadata: SessionMetaRepositoryPort
  resources: BackupHostResources
  /** Uses the host's direct access to migrate a selected local conversation. */
  ensureRows(sessionId: string): Promise<void>
  listSessionIds(): AsyncIterable<string>
  getSettings(): Settings
  refresh(): Promise<void>
}
