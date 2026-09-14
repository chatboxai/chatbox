import { fitsInlineBackupJson, throwIfAborted, toLogicalBackupRow, type BackupRow } from '@chatbox/core/backup'
import type { MessageRow } from '@chatbox/core/session/session-tree'
import type { StoredMessageRow } from './session-row-idb-payload'

/** Probe only a record-sized prefix, then continue the same source when a message needs payload blocks. */
export async function* prepareIndexedDBBackupMessage(
  stored: StoredMessageRow,
  maxRecordBytes: number,
  chunks: () => AsyncGenerator<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<BackupRow> {
  const { message, payload, ...metadata } = stored
  if (!payload && !message) throw new Error('IndexedDB backup message is missing')
  const shell: MessageRow = { ...metadata, message: { id: stored.messageId, role: 'user', contentParts: [] } }
  const logical = toLogicalBackupRow({ kind: 'message', message: shell })
  const overhead = new TextEncoder().encode(JSON.stringify({ ...logical, value: null })).length - 4
  const budget = maxRecordBytes - overhead
  const asPayload = (source: () => AsyncGenerator<Uint8Array>): BackupRow => ({
    kind: 'message',
    message: shell,
    payload: { size: payload?.size, chunks: source },
  })
  if (budget < 1 || (payload && payload.size > budget)) {
    yield asPayload(chunks)
    return
  }
  if (!payload && fitsInlineBackupJson(message, budget)) {
    yield { kind: 'message', message: { ...metadata, message: message! } }
    return
  }
  const input = chunks()
  try {
    const prefix = new Uint8Array(budget)
    let used = 0
    while (true) {
      throwIfAborted(signal)
      const next = await input.next()
      if (next.done) {
        const value = payload
          ? (JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(prefix.subarray(0, used))
            ) as MessageRow['message'])
          : message!
        yield { kind: 'message', message: { ...metadata, message: value } }
        return
      }
      if (next.value.length > budget - used) {
        yield asPayload(async function* () {
          throwIfAborted(signal)
          if (used) yield prefix.subarray(0, used)
          yield next.value
          yield* input
        })
        return
      }
      prefix.set(next.value, used)
      used += next.value.length
    }
  } finally {
    await input.return(undefined)
  }
}
