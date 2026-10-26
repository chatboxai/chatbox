import { exportBackupV3, exportBackupV3Stream } from '../backup-v3/archive'
import { exportBackupV2Stream } from './legacy'
import type { BackupExportOptions, BackupExportResult } from './types'
import { exportBackupV1Stream } from './v1'

export type { BackupExportFormat, BackupExportOptions, BackupExportResult, LegacyBackupManifest } from './types'

export async function* exportBackupStream(
  options: Omit<BackupExportOptions, 'output'>
): AsyncGenerator<Uint8Array, BackupExportResult> {
  if (options.format === undefined || options.format === 'v3') return yield* exportBackupV3Stream(options)
  if (options.format === 'v2') return yield* exportBackupV2Stream(options)
  if (options.format === 'v1') return yield* exportBackupV1Stream(options)
  throw new Error('Unsupported backup export format')
}

export async function exportBackup(options: BackupExportOptions): Promise<BackupExportResult> {
  if (options.format === undefined || options.format === 'v3') return exportBackupV3(options)
  const stream = exportBackupStream(options)
  try {
    while (true) {
      const entry = await stream.next()
      if (entry.done) {
        await options.output.close()
        return entry.value
      }
      await options.output.write(entry.value)
    }
  } catch (error) {
    const cleanup = await Promise.allSettled([options.output.abort(), stream.return(undefined as never)])
    const errors = cleanup.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason)
    if (errors.length)
      throw new AggregateError([error, ...errors], 'Backup export failed and output cleanup is incomplete')
    throw error
  }
}
