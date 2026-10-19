import { convertLegacyTreeToRowFormat, legacyActiveThreadId } from '../application/session/compatibility/row-format'
import { migrateSession } from '../application/session/compatibility/session-load'
import { verifySessionTreeRoundTrip } from '../session/session-tree/verify'
import type { Session } from '../types/session'
import { throwIfAborted } from './abort'
import { fitsInlineBackupJson, jsonUtf8Blocks } from './json-stream'
import { BackupMessageValidator } from './payload'
import { DEFAULT_BACKUP_PAGE_LIMITS, type BackupSessionCandidate, type BackupSessionStore } from './session-port'

/** Complete legacy objects are accepted only by the external conversion boundary. */
export function prepareLegacySessionRows(source: Session) {
  const verified = verifySessionTreeRoundTrip(migrateSession(source), {
    activeThreadId: legacyActiveThreadId(source),
    now: 0,
  })
  if (!verified.ok) throw new Error(`Session ${source.id} cannot be imported: ${verified.reason}`)
  return convertLegacyTreeToRowFormat(verified.tree, verified.session.messageForksHash)
}

export async function stageLegacySessionRows(
  store: BackupSessionStore,
  source: Session,
  signal?: AbortSignal
): Promise<BackupSessionCandidate> {
  const tree = prepareLegacySessionRows(source)
  const candidate = await store.beginBackupRestore(source.id)
  try {
    throwIfAborted(signal)
    await candidate.append({ kind: 'header', record: tree.session })
    for (const thread of tree.threads) {
      throwIfAborted(signal)
      await candidate.append({ kind: 'thread', thread })
    }
    for (const message of tree.messages) {
      throwIfAborted(signal)
      if (fitsInlineBackupJson({ kind: 'message', message }, DEFAULT_BACKUP_PAGE_LIMITS.maxRecordBytes))
        await candidate.append({ kind: 'message', message })
      else {
        if (!candidate.appendPayload) throw new Error('Backup storage does not support payload restoration')
        const validator = new BackupMessageValidator()
        let size = 0
        for (const bytes of jsonUtf8Blocks(message.message)) {
          throwIfAborted(signal)
          validator.write(bytes)
          size += bytes.length
          await candidate.appendPayload(bytes)
        }
        await candidate.append({
          kind: 'message',
          message: { ...message, message: validator.finish() },
          payload: { size },
        })
      }
    }
    return candidate
  } catch (error) {
    await candidate.dispose()
    throw error
  }
}
