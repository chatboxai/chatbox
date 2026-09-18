import type { Message } from '@shared/types'
import { decodeSessionTree } from '../session/session-tree/decode'
import type { SessionTree } from '../session/session-tree/types'
import { throwIfAborted } from './abort'
import { BackupJsonSize } from './json-size'
import { materializeBackupPayload, NATIVE_PAYLOAD_LIMIT_BYTES } from './payload'
import type { PreparedBackupSession } from './preflight'
import { prepareBackupMessagePayload } from './resource-payload'
import { prepareSessionForBackup } from './resources'
import { type BackupSessionStore, backupPageLimits } from './session-port'
import { BackupSourceBudgetError, MAX_BACKUP_SESSION_STRUCTURE_BYTES } from './source-check'

const encoder = new TextEncoder()
const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length

/** Counts canonical v2 bytes; a completed message occurs exactly once in a valid session tree.
 * Stored payload sizes bound the prepared bytes from above: a session whose bound exceeds the
 * threshold settles on the sharded layout without reading any payload. */
export async function classifyBackupSession(
  store: BackupSessionStore,
  id: string,
  threshold: number,
  signal?: AbortSignal,
  nativePayloadLimit = NATIVE_PAYLOAD_LIMIT_BYTES
): Promise<PreparedBackupSession> {
  const tree: Partial<SessionTree> & Pick<SessionTree, 'threads' | 'messages'> = { threads: [], messages: [] }
  let messageBytes = 0
  let boundBytes = 0
  let difference = 0
  let indexBytes = 0
  const deferred: Array<{ chunks: () => AsyncIterable<Uint8Array>; size: number; shellBytes: number }> = []
  const keep = (value: unknown) => {
    indexBytes += jsonBytes(value)
    if (indexBytes > MAX_BACKUP_SESSION_STRUCTURE_BYTES)
      throw new BackupSourceBudgetError('Backup session structure exceeds budget')
  }
  const sharded = (): PreparedBackupSession => ({ id, name: tree.session?.name ?? id, layout: 'sharded' })
  /** Prepared bytes of one payload, or undefined once the running total leaves the single-file budget. */
  const measure = async (chunks: () => AsyncIterable<Uint8Array>, size?: number) => {
    if (size !== undefined && size <= nativePayloadLimit) {
      const { message } = await materializeBackupPayload(chunks(), size)
      return jsonBytes(prepareSessionForBackup({ id, name: '', messages: [message] }).messages[0])
    }
    const counter = new BackupJsonSize()
    for await (const block of prepareBackupMessagePayload(chunks())) {
      throwIfAborted(signal)
      counter.write(block)
      if (messageBytes + counter.bytes > threshold) return undefined
    }
    return counter.finish()
  }
  for await (const row of store.iterateBackupRows(id, backupPageLimits(), signal)) {
    throwIfAborted(signal)
    if (row.kind === 'header') {
      if (tree.session || row.record.id !== id) throw new Error('Invalid backup session header')
      keep(row.record)
      tree.session = row.record
    } else if (row.kind === 'thread') {
      keep(row.thread)
      tree.threads.push(row.thread)
    } else {
      if (!tree.session) throw new Error('Backup session header is missing')
      // Topology needs message identity, not a substring referencing its original text.
      const message: Message = { id: row.message.messageId, role: 'user', contentParts: [] }
      const shellBytes = jsonBytes(message)
      const structural = { ...row.message, message }
      let size: number
      if (row.payload) {
        if (!row.payload.chunks) throw new Error('Backup payload source is missing')
        if (row.payload.size !== undefined) {
          boundBytes += row.payload.size
          if (messageBytes + boundBytes > threshold) return sharded()
          deferred.push({ chunks: row.payload.chunks, size: row.payload.size, shellBytes })
          keep(structural)
          tree.messages.push(structural)
          continue
        }
        const measured = await measure(row.payload.chunks)
        if (measured === undefined) return sharded()
        size = measured
      } else {
        const prepared = prepareSessionForBackup({ id, name: '', messages: [row.message.message] })
        size = jsonBytes(prepared.messages[0])
      }
      messageBytes += size
      if (messageBytes > threshold) return sharded()
      difference += size - shellBytes
      keep(structural)
      tree.messages.push(structural)
    }
  }
  for (const item of deferred) {
    throwIfAborted(signal)
    const size = await measure(item.chunks, item.size)
    if (size === undefined) return sharded()
    messageBytes += size
    if (messageBytes > threshold) return sharded()
    difference += size - item.shellBytes
  }
  throwIfAborted(signal)
  if (!tree.session) throw new Error('Backup session header is missing')
  const decoded = decodeSessionTree(tree as SessionTree)
  if (!decoded.ok) throw new Error(decoded.reason)
  const size = jsonBytes(prepareSessionForBackup(decoded.session)) + difference
  if (!Number.isSafeInteger(size) || size < 0) throw new BackupSourceBudgetError('Invalid backup session size')
  return size > threshold ? sharded() : { id, name: tree.session.name, layout: 'single', size }
}
