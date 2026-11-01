import type { SessionAttachmentRepositoryPort } from '@chatbox/core/ports'
import type { SessionAttachmentOwnershipClaim } from '@shared/types'

export interface SessionOwnership {
  messageIds: string[]
  attachmentReferences: SessionAttachmentOwnershipClaim[]
}

/** Retains ownership metadata only; incomplete or conflicting scans must never authorize orphan deletion. */
export async function collectSessionOwnership(
  source: SessionAttachmentRepositoryPort,
  sessionId: string
): Promise<SessionOwnership> {
  const messageIds = new Set<string>()
  const claims = new Map<number, SessionAttachmentOwnershipClaim>()
  for await (const row of source.iterateSessionAttachmentFacts({ sessionId, scope: 'session' })) {
    if (row.sessionId !== sessionId || messageIds.has(row.messageId)) throw new Error('Inconsistent ownership metadata')
    messageIds.add(row.messageId)
    for (const attachmentId of row.attachmentOwnershipIds)
      if (!claims.has(attachmentId)) claims.set(attachmentId, { attachmentId, sessionId, messageId: row.messageId })
  }
  return { messageIds: [...messageIds], attachmentReferences: [...claims.values()] }
}
