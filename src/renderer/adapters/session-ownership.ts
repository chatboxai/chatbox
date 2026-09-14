import { BackupMessageValidator, DEFAULT_BACKUP_PAGE_LIMITS, type BackupSessionStore } from '@chatbox/core/backup'
import type { SessionAttachmentOwnershipClaim } from '@shared/types'
import { collectAttachmentOwnershipClaims } from '../../shared/session-attachment-rag/ownership'

export interface SessionOwnership {
  messageIds: string[]
  attachmentReferences: SessionAttachmentOwnershipClaim[]
}

/** Retains ownership metadata only; incomplete or conflicting scans must never authorize orphan deletion. */
export async function collectSessionOwnership(
  source: BackupSessionStore,
  sessionId: string
): Promise<SessionOwnership> {
  const messageIds = new Set<string>()
  const claims = new Map<number, SessionAttachmentOwnershipClaim>()
  let header = false
  for await (const row of source.iterateBackupRows(sessionId, DEFAULT_BACKUP_PAGE_LIMITS)) {
    if (row.kind === 'header') {
      if (header || row.record.id !== sessionId) throw new Error('Invalid session ownership header')
      header = true
    }
    if (!header) throw new Error('Missing session ownership header')
    if (row.kind !== 'message') continue
    let message = row.message.message
    if (row.payload) {
      if (!row.payload.chunks) throw new Error('Missing session ownership payload')
      const validator = new BackupMessageValidator()
      let size = 0
      for await (const chunk of row.payload.chunks()) {
        size += chunk.length
        validator.write(chunk)
      }
      if (row.payload.size !== undefined && row.payload.size !== size) throw new Error('Incomplete ownership payload')
      message = validator.finish()
      // The validator retains 4096-character scalar prefixes; ownership requires a complete ID.
      if (message.id.length >= 4096) throw new Error('Session ownership message ID exceeds projection budget')
    }
    if (row.message.sessionId !== sessionId || message.id !== row.message.messageId) {
      throw new Error('Inconsistent session ownership message')
    }
    messageIds.add(message.id)
    for (const claim of collectAttachmentOwnershipClaims(sessionId, [message])) {
      if (!claims.has(claim.attachmentId)) claims.set(claim.attachmentId, claim)
    }
  }
  if (!header) throw new Error('Missing session ownership source')
  return { messageIds: [...messageIds], attachmentReferences: [...claims.values()] }
}
