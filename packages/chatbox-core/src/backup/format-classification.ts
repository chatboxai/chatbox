import { throwIfAborted } from './abort'
import { jsonUtf8Blocks } from './json-stream'
import type { PreparedBackupSession } from './preflight'
import { prepareBackupMessagePayload } from './resource-payload'
import { prepareMessageForBackup } from './resources'
import { RowJsonLayout, SingleFileBudgetError } from './row-json'
import { type BackupSessionStore, backupPageLimits } from './session-port'
import { materializeBackupPayload, NATIVE_PAYLOAD_LIMIT_BYTES } from './payload'

const encoder = new TextEncoder()

/** Stored payload sizes select large exports before any message body is read. */
export async function classifyBackupSession(
  store: BackupSessionStore,
  id: string,
  threshold: number,
  signal?: AbortSignal,
  nativePayloadLimit = NATIVE_PAYLOAD_LIMIT_BYTES
): Promise<PreparedBackupSession> {
  const layout = new RowJsonLayout(id)
  const sizes = new Map<string, number>()
  const deferred: Array<{ id: string; size: number; chunks: () => AsyncIterable<Uint8Array> }> = []
  let messageBytes = 0
  let boundBytes = 0
  const sharded = (): PreparedBackupSession => ({ id, name: layout.header.name, layout: 'sharded' })
  const measure = async (chunks: () => AsyncIterable<Uint8Array>, storedSize?: number) => {
    if (storedSize !== undefined && storedSize <= nativePayloadLimit) {
      const { message } = await materializeBackupPayload(chunks(), storedSize)
      let size = 0
      for (const block of jsonUtf8Blocks(prepareMessageForBackup(message))) size += block.length
      return size
    }
    let size = 0
    for await (const block of prepareBackupMessagePayload(chunks())) {
      throwIfAborted(signal)
      size += block.length
      if (messageBytes + size > threshold)
        throw new SingleFileBudgetError('Backup session exceeds its single-file budget')
    }
    return size
  }
  try {
    for await (const row of store.iterateBackupRows(id, backupPageLimits(), signal)) {
      throwIfAborted(signal)
      if (row.kind === 'message' && row.payload?.size !== undefined) {
        boundBytes += row.payload.size
        if (messageBytes + boundBytes > threshold) return sharded()
      }
      layout.add(row)
      if (row.kind !== 'message') continue
      let size = 0
      if (row.payload) {
        if (!row.payload.chunks) throw new Error('Backup payload source is missing')
        if (row.payload.size !== undefined) {
          deferred.push({ id: row.message.messageId, size: row.payload.size, chunks: row.payload.chunks })
          continue
        }
        size = await measure(row.payload.chunks)
      } else {
        for (const block of jsonUtf8Blocks(prepareMessageForBackup(row.message.message))) size += block.length
      }
      messageBytes += size
      if (messageBytes > threshold) return sharded()
      sizes.set(row.message.messageId, size)
    }
    for (const item of deferred) {
      const size = await measure(item.chunks, item.size)
      messageBytes += size
      sizes.set(item.id, size)
    }
    let size = 0
    for (const part of layout.parts()) {
      size += typeof part === 'string' ? encoder.encode(part).length : sizes.get(part.messageId)!
      if (size > threshold) return sharded()
    }
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid backup session size')
    return { id, name: layout.header.name, layout: 'single', size }
  } catch (error) {
    if (error instanceof SingleFileBudgetError) return sharded()
    throw error
  }
}
