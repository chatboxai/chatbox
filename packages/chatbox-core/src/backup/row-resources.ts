import { BackupMessageValidator } from './payload'
import { collectMessageReferences, type ResourceReference } from './resources'
import { DEFAULT_BACKUP_PAGE_LIMITS, type BackupSessionStore } from './session-port'
import { throwIfAborted } from './abort'

/** Complete resource identities with bounded message projections and no history aggregation. */
export async function* iterateRowResourceReferences(
  source: BackupSessionStore,
  sessionId: string,
  signal?: AbortSignal
): AsyncGenerator<ResourceReference> {
  let header = false
  for await (const row of source.iterateBackupRows(sessionId, DEFAULT_BACKUP_PAGE_LIMITS, signal)) {
    throwIfAborted(signal)
    if (row.kind === 'header') {
      if (header || row.record.id !== sessionId) throw new Error('Invalid resource scan header')
      header = true
      if (row.record.assistantAvatarKey) yield { storageKey: row.record.assistantAvatarKey, kind: 'avatar', sessionId }
      if (row.record.backgroundImage?.type === 'storage-key')
        yield { storageKey: row.record.backgroundImage.storageKey, kind: 'background', sessionId }
    }
    if (!header) throw new Error('Missing resource scan header')
    if (row.kind !== 'message') continue
    let message = row.message.message
    if (row.payload) {
      if (!row.payload.chunks) throw new Error('Missing resource scan payload')
      const validator = new BackupMessageValidator()
      let bytes = 0
      for await (const chunk of row.payload.chunks()) {
        throwIfAborted(signal)
        bytes += chunk.length
        validator.write(chunk)
      }
      if (row.payload.size !== undefined && row.payload.size !== bytes)
        throw new Error('Incomplete resource scan payload')
      message = validator.finish()
    }
    if (row.message.sessionId !== sessionId || message.id !== row.message.messageId)
      throw new Error('Resource scan identity mismatch')
    const references: ResourceReference[] = []
    collectMessageReferences(message, sessionId, references, [])
    yield* references
  }
  if (!header) throw new Error('Resource scan session is unavailable')
}
