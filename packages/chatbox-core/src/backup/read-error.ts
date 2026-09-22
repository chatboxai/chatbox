import type { BackupWarningReason } from './types'

export class BackupReadError extends Error {
  constructor(
    readonly reason: BackupWarningReason,
    message: string
  ) {
    super(message)
    this.name = 'BackupReadError'
  }
}
