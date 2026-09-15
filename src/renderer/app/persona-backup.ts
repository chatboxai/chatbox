import { type BackupExportOptions, exportBackupArchive } from '@chatbox/core/backup/export-backup'
import { importLegacyJsonBackup, type LegacyBackupImportOptions } from '@chatbox/core/backup/legacy-import'
import type { BackupFile } from '@chatbox/core/backup/types'
import { withAgentPersonaLocks } from '@/stores/agentPersonaStore'

export function exportRendererBackupArchive(options: BackupExportOptions) {
  return withAgentPersonaLocks(() => exportBackupArchive(options))
}

export function importRendererLegacyJsonBackup(file: BackupFile, options: LegacyBackupImportOptions) {
  return withAgentPersonaLocks(() => importLegacyJsonBackup(file, options))
}
