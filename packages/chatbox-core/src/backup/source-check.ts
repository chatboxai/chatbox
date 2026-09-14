import { throwIfAborted } from './abort'
import { jsonUtf8Blocks } from './json-stream'
import { BackupMessageValidator } from './payload'
import { BackupGraphValidator, LogicalBackupRowSchema, toLogicalBackupRow } from './sharded-format'
import type { BackupPageLimits, BackupRow, BackupSessionStore } from './session-port'

export class BackupSourceBudgetError extends Error {}
export const MAX_BACKUP_SESSION_STRUCTURE_BYTES = 16 * 1024 * 1024
/** Validates message bytes and topology while the archive writer consumes the source. */
export async function* checkedBackupRows(
  store: BackupSessionStore,
  id: string,
  limits: BackupPageLimits,
  signal: AbortSignal | undefined
): AsyncGenerator<BackupRow> {
  const graph = new BackupGraphValidator(id)
  let bytes = 0
  const update = (part: Uint8Array) => {
    bytes += part.length
    if (bytes > 4 * 1024 ** 3) throw new BackupSourceBudgetError('Backup session exceeds the archive budget')
  }
  for await (const row of store.iterateBackupRows(id, limits, signal)) {
    throwIfAborted(signal)
    const structure = row.kind === 'message' ? { kind: row.kind, message: { ...row.message, message: undefined } } : row
    for (const part of jsonUtf8Blocks(structure)) update(part)
    let logical = toLogicalBackupRow(row)
    if (row.kind === 'message' && logical.kind === 'message') {
      const validator = new BackupMessageValidator()
      const input = row.payload?.chunks
      let consumed = false
      let size = 0
      const chunks = async function* () {
        for await (const part of input ? input() : jsonUtf8Blocks(row.message.message)) {
          throwIfAborted(signal)
          size += part.length
          update(part)
          validator.write(part)
          yield part
        }
        if (row.payload?.size !== undefined && size !== row.payload.size)
          throw new Error('Backup source payload size changed')
        consumed = true
      }
      if (row.payload) yield { ...row, payload: { ...row.payload, chunks } }
      else {
        for await (const part of chunks()) void part
        yield row
      }
      if (!consumed) throw new Error('Backup source payload was not consumed')
      logical = { ...logical, value: validator.finish() }
    } else yield row
    graph.add(LogicalBackupRowSchema.parse(logical))
  }
  graph.finish()
  throwIfAborted(signal)
}
