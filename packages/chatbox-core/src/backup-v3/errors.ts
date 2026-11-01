import { isAbortError } from '../utils/abort'
import type { BackupResult } from './types'

/** Import can stop after earlier items have already been published. */
export class BackupImportError extends Error {
  constructor(
    cause: unknown,
    readonly partialResult: BackupResult
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = isAbortError(cause) ? 'AbortError' : 'BackupImportError'
  }
}

export function getBackupImportPartialResult(error: unknown): BackupResult | undefined {
  return error instanceof BackupImportError ? error.partialResult : undefined
}
