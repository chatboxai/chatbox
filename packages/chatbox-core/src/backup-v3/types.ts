import type { ByteSink, ByteSource, ClosableByteSource } from '../io'
import type { MessageRow, SessionRowRecord, ThreadRow } from '../session/session-tree/types'

export type BackupSession = Omit<SessionRowRecord, 'storageFormat' | 'rowFormatVersion' | 'rowAuthority'>
export type BackupThread = Omit<ThreadRow, 'activeLeafMessageId' | 'summary' | 'control'>
export type BackupMessage = Omit<MessageRow, 'status' | 'selected' | 'facts' | 'fork'>
export type BackupGlobalCategory =
  | 'settings'
  | 'copilot'
  | 'session-settings'
  | 'folder'
  | 'soul'
  | 'global-memory'
  | 'copilot-memory'
  | 'memory-identities'

export type BackupBusinessRecord =
  | { type: 'session'; session: BackupSession; meta?: { sortOrder: number; createdAt: number } }
  | { type: 'thread'; thread: BackupThread }
  | { type: 'message'; message: BackupMessage }
  | { type: 'global'; category: BackupGlobalCategory; id: string; value: unknown }

export interface BackupResourceRecord {
  type: 'resource'
  resourceId: string
  path: string
  mimeType: string
  contentType: 'text' | 'binary'
  size: number
}
export interface BackupWarningRecord {
  type: 'warning'
  category: string
  objectId: string
  message: string
}
export type BackupRecord = BackupBusinessRecord | BackupResourceRecord | BackupWarningRecord
export interface BackupSelection {
  sessions: boolean
  sessionIds?: readonly string[]
  settings: boolean
  copilots: boolean
  credentials: boolean
}
export interface BackupManifest {
  format: 'chatbox-backup'
  formatVersion: 3
  layout: 'rows'
  archiveId: string
  createdAt: string
  producer: string
  selection: Omit<BackupSelection, 'sessionIds'>
}
export type BackupCounts = Record<BackupRecord['type'], number>
export interface BackupComplete {
  archiveId: string
  counts?: BackupCounts
  resourceBytes?: number
  dataBytes?: number
  entryCount?: number
  uncompressedBytes?: number
}
export type BackupStatistics = Required<BackupComplete>
export interface BackupProgress {
  phase: 'preparing' | 'records' | 'resources' | 'validating' | 'publishing' | 'cleaning' | 'complete'
  records: number
  messages: number
  resources: number
  bytes: number
}
/** Task-scoped disk files and insertion-ordered indexes. put must be atomic insert-if-absent. */
export interface BackupWorkspace {
  createFile(name: string): Promise<ByteSink>
  openFile(name: string): Promise<ClosableByteSource>
  put(table: string, key: string, value: string): Promise<boolean>
  get(table: string, key: string): Promise<string | null>
  entries(table: string): AsyncIterable<{ key: string; value: string }>
  dispose(): Promise<void>
}
export interface BackupResourceSource {
  mimeType: string
  contentType: 'text' | 'binary'
  source: ClosableByteSource
}
export interface BackupExportSource {
  records(selection: BackupSelection, signal?: AbortSignal): AsyncIterable<BackupBusinessRecord | BackupWarningRecord>
  openResource(key: string, signal?: AbortSignal): Promise<BackupResourceSource | null>
}
export interface BackupImportIssue {
  code: string
  objectId?: string
  sessionId?: string
  message: string
}
export type BackupImportIssueReporter = (issue: BackupImportIssue) => void
export interface BackupImportSummary {
  importedSessions: number
  importedMessages: number
  importedResources: number
  importedGlobals: number
  skippedRecords: number
}
export interface BackupImportReport extends BackupImportSummary {
  issueCount: number
  issues: BackupImportIssue[]
}
export interface BackupImportContext {
  /** Exact global storage keys present in an input whose collections are optional. */
  includedGlobalKeys?: readonly string[]
}
/** Projections produced by an internal converter for one complete conversation. */
export interface BackupImportProjections {
  sessionId: string
  forks: ReadonlyMap<string, NonNullable<MessageRow['fork']>>
}
/** The host publishes each complete resource, global value, and session independently. */
export interface BackupImportTarget {
  begin(
    manifest: BackupManifest,
    onIssue?: BackupImportIssueReporter,
    signal?: AbortSignal,
    context?: BackupImportContext
  ): Promise<void>
  appendRecords(records: BackupBusinessRecord[]): Promise<void>
  /** Closing the sink publishes the complete resource atomically. */
  createResource(resource: BackupResourceRecord): Promise<ByteSink>
  /** Finishes global values and the last session. Earlier successful publications remain committed. */
  prepare(projections?: BackupImportProjections): Promise<BackupImportSummary | void>
  getSummary(): BackupImportSummary
  /** Deletes only task-owned temporary data, never previously published values. */
  cleanup(): Promise<void>
}
export interface BackupLimits {
  maxRecordBytes: number
  maxResourceBytes: number
  maxDataBytes: number
  maxGlobalBytes: number
  maxArchiveBytes: number
  maxUncompressedBytes: number
  maxEntries: number
}
export interface BackupCodec {
  /** Strict UTF-8 decoding, rejecting malformed input and stripping one leading BOM. */
  decodeUtf8(bytes: Uint8Array): string
}
export interface BackupOptions {
  signal?: AbortSignal
  onProgress?: (progress: BackupProgress) => void
  limits?: Partial<BackupLimits>
  compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  codec?: BackupCodec
}
export interface ExportBackupV3Options extends BackupOptions {
  archiveId: string
  createdAt?: string
  producer: string
  selection: BackupSelection
  source: BackupExportSource
  workspace: BackupWorkspace
  output: ByteSink
}
export interface ImportBackupV3Options extends BackupOptions {
  source: ByteSource
  workspace: BackupWorkspace
  target: BackupImportTarget
}
export interface BackupResult {
  manifest: BackupManifest
  complete: BackupStatistics
  cleanupPending: boolean
  refreshPending?: boolean
  importReport?: BackupImportReport
  /** Export only: referenced resources that were absent from local storage and left out of the archive. */
  missingResources?: number
}
