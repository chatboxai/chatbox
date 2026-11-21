import { type BackupExportResult, exportBackupStream } from '@chatbox/core/backup-export'
import { type BackupHostOptions, createBackupExportSource } from '@chatbox/core/backup-host'
import { inspectBackup } from '@chatbox/core/backup-import'
import type { ByteSource } from '@chatbox/core/io'
import { maxSyncArchiveBytes, type SyncSelection } from '@shared/sync'

export async function exportSyncBackup(
  options: BackupHostOptions,
  selection: SyncSelection,
  signal: AbortSignal
): Promise<BackupExportResult & { bytes: Uint8Array }> {
  const stream = exportBackupStream({
    format: 'v3',
    archiveId: options.jobId,
    producer: 'Chatbox',
    selection,
    source: createBackupExportSource(options),
    workspace: options.workspace,
    signal,
  })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    let item = await stream.next()
    while (!item.done) {
      size += item.value.byteLength
      if (size > maxSyncArchiveBytes) throw new Error('sync_archive_too_large')
      chunks.push(item.value)
      item = await stream.next()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { ...item.value, bytes }
  } finally {
    await stream.return(undefined as never)
  }
}

export async function validateSyncBackup(source: ByteSource, selection: SyncSelection, signal: AbortSignal) {
  const { formatVersion, selection: included } = await inspectBackup(source, { signal })
  if (
    formatVersion !== 3 ||
    selection.sessions !== included.sessions ||
    selection.settings !== included.settings ||
    selection.copilots !== included.copilots ||
    selection.credentials !== included.credentials
  ) {
    throw new Error('unsupported_cloud_sync_payload')
  }
}

export function syncBackupSource(bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)])
}
