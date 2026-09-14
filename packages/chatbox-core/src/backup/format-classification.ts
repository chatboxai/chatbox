import type { Message } from '@shared/types'
import { decodeSessionTree } from '../session/session-tree/decode'
import type { SessionTree } from '../session/session-tree/types'
import { throwIfAborted } from './abort'
import { BackupJsonSize } from './json-size'
import type { PreparedBackupSession } from './preflight'
import { prepareBackupMessagePayload } from './resource-payload'
import { prepareSessionForBackup } from './resources'
import { backupPageLimits, type BackupSessionStore } from './session-port'
import { BackupSourceBudgetError, MAX_BACKUP_SESSION_STRUCTURE_BYTES } from './source-check'

const encoder = new TextEncoder()
const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length

/** Counts canonical v2 bytes; a completed message occurs exactly once in a valid session tree. */
export async function classifyBackupSession(
  store: BackupSessionStore,
  id: string,
  threshold: number,
  signal?: AbortSignal
): Promise<PreparedBackupSession> {
  const tree: Partial<SessionTree> & Pick<SessionTree, 'threads' | 'messages'> = { threads: [], messages: [] }
  let messageBytes = 0
  let difference = 0
  let indexBytes = 0
  const keep = (value: unknown) => {
    indexBytes += jsonBytes(value)
    if (indexBytes > MAX_BACKUP_SESSION_STRUCTURE_BYTES)
      throw new BackupSourceBudgetError('Backup session structure exceeds budget')
  }
  const sharded = (): PreparedBackupSession => ({ id, name: tree.session?.name ?? id, layout: 'sharded' })
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
      let size: number
      if (row.payload) {
        if (!row.payload.chunks) throw new Error('Backup payload source is missing')
        const counter = new BackupJsonSize()
        for await (const block of prepareBackupMessagePayload(row.payload.chunks())) {
          throwIfAborted(signal)
          counter.write(block)
          if (messageBytes + counter.bytes > threshold) return sharded()
        }
        size = counter.finish()
      } else {
        const prepared = prepareSessionForBackup({ id, name: '', messages: [row.message.message] })
        size = jsonBytes(prepared.messages[0])
      }
      messageBytes += size
      if (messageBytes > threshold) return sharded()
      // Topology needs message identity, not a substring referencing its original text.
      const message: Message = { id: row.message.messageId, role: 'user', contentParts: [] }
      difference += size - jsonBytes(message)
      const structural = { ...row.message, message }
      keep(structural)
      tree.messages.push(structural)
    }
  }
  throwIfAborted(signal)
  if (!tree.session) throw new Error('Backup session header is missing')
  const decoded = decodeSessionTree(tree as SessionTree)
  if (!decoded.ok) throw new Error(decoded.reason)
  const size = jsonBytes(prepareSessionForBackup(decoded.session)) + difference
  if (!Number.isSafeInteger(size) || size < 0) throw new BackupSourceBudgetError('Invalid backup session size')
  return size > threshold ? sharded() : { id, name: tree.session.name, layout: 'single', size }
}
