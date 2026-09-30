import { BackupSourceBudgetError } from './source-check'
import type { BackupWarning } from './types'

export const MAX_BACKUP_WARNING_BYTES = 4 * 1024 * 1024
export const MAX_BACKUP_WARNINGS = 50_000

export class BackupWarningBudgetError extends BackupSourceBudgetError {
  constructor() {
    super('Backup warning index exceeds budget')
  }
}

/** Bounds retained warning JSON and identity keys; object and Map overhead are additional. */
export class BackupWarningIndex {
  private readonly entries = new Map<string, BackupWarning>()
  private bytes = 2

  constructor(
    private readonly maxBytes = MAX_BACKUP_WARNING_BYTES,
    private readonly maxCount = MAX_BACKUP_WARNINGS
  ) {}

  get size(): number {
    return this.entries.size
  }

  add(warning: BackupWarning): void {
    const key = JSON.stringify(warning)
    if (this.entries.has(key)) return
    const bytes = new TextEncoder().encode(key).length + (this.entries.size ? 1 : 0)
    if (this.entries.size >= this.maxCount || this.bytes + bytes > this.maxBytes) throw new BackupWarningBudgetError()
    this.entries.set(key, warning)
    this.bytes += bytes
  }

  addAll(warnings: Iterable<BackupWarning>): void {
    for (const warning of warnings) this.add(warning)
  }

  toArray(): BackupWarning[] {
    return Array.from(this.entries.values())
  }
}
