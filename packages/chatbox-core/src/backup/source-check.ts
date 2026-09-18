import type { Message } from '@shared/types'
import { throwIfAborted } from './abort'
import { jsonUtf8Blocks } from './json-stream'
import {
  BackupMessageValidator,
  materializeBackupPayload,
  NATIVE_PAYLOAD_LIMIT_BYTES,
  payloadBlocksOf,
} from './payload'
import type { BackupPageLimits, BackupRow, BackupSessionStore } from './session-port'
import { BackupGraphValidator, LogicalBackupRowSchema, toLogicalBackupRow } from './sharded-format'

export class BackupSourceBudgetError extends Error {}
// biome-ignore lint/suspicious/useAwait: in-memory blocks exposed through the async chunk contract
async function* materializedChunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield* payloadBlocksOf(bytes)
}
export const MAX_BACKUP_SESSION_STRUCTURE_BYTES = 16 * 1024 * 1024
/** Validates message bytes and topology while the archive writer consumes the source. */
export async function* checkedBackupRows(
  store: BackupSessionStore,
  id: string,
  limits: BackupPageLimits,
  signal: AbortSignal | undefined,
  nativePayloadLimit = NATIVE_PAYLOAD_LIMIT_BYTES
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
    if (
      row.kind === 'message' &&
      logical.kind === 'message' &&
      row.payload?.chunks &&
      row.payload.size !== undefined &&
      row.payload.size <= nativePayloadLimit
    ) {
      throwIfAborted(signal)
      const { bytes, message } = await materializeBackupPayload(row.payload.chunks(), row.payload.size)
      update(bytes)
      yield {
        ...row,
        payload: {
          size: bytes.length,
          chunks: () => materializedChunks(bytes),
          original: () => message,
          value: message,
        },
      }
      logical = { ...logical, value: message }
    } else if (row.kind === 'message' && logical.kind === 'message') {
      const validator = new BackupMessageValidator()
      const input = row.payload?.chunks
      let consumed = false
      let size = 0
      let projection: Message | undefined
      const original = () => {
        if (!consumed) throw new Error('Backup source payload was not consumed')
        projection ??= validator.finish()
        return projection
      }
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
      if (row.payload) yield { ...row, payload: { ...row.payload, chunks, original } }
      else {
        for await (const part of chunks()) void part
        yield row
      }
      logical = { ...logical, value: original() }
    } else yield row
    graph.add(LogicalBackupRowSchema.parse(logical))
  }
  graph.finish()
  throwIfAborted(signal)
}
