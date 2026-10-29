import type { BackupManifest, BackupResult, ExportBackupV3Options } from '../backup-v3/types'
import type { ResourceReference } from '../resources'
import type { SessionMetaRecord } from '../types/session'

export type BackupExportFormat = 'v3' | 'v2' | 'v1'
export interface LegacyBackupEntry {
  path: string
  size: number
  checksum: { algorithm: 'sha256'; value: string }
}
export interface LegacyBackupSession extends LegacyBackupEntry {
  id: string
  meta: SessionMetaRecord
  resourceIds: string[]
}
export interface LegacyBackupResource extends LegacyBackupEntry {
  id: string
  originalStorageKeys: string[]
  sessionIds: string[]
  scope: 'session' | 'shared' | 'global'
  encoding: 'utf8' | 'data-url-base64'
  mimeType: string
  kind: ResourceReference['kind']
  filename?: string
}
export interface LegacyBackupManifest {
  format: 'chatbox-backup'
  formatVersion: 2
  exportedAt: string
  application: { name: 'Chatbox'; version: string; platform: string }
  exportItems: Array<'setting' | 'key' | 'conversations' | 'copilot'>
  data: { settings?: LegacyBackupEntry; copilots?: LegacyBackupEntry; sessionSettings?: LegacyBackupEntry }
  sessions: LegacyBackupSession[]
  resources: LegacyBackupResource[]
  warnings: Array<{
    code: 'external-resource-skipped'
    itemType: 'session' | 'resource'
    itemId?: string
    message: string
  }>
  stats: { sessionCount: number; resourceCount: number; deduplicatedResourceCount: number; warningCount: number }
}
export type BackupExportResult = Omit<BackupResult, 'manifest'> & {
  /** V1 is a plain JSON object and has no manifest. */
  manifest: BackupManifest | LegacyBackupManifest | null
}
export interface BackupExportOptions extends ExportBackupV3Options {
  format?: BackupExportFormat
  application?: { version: string; platform: string }
}
