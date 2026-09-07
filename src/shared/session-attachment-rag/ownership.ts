import type { Message, SessionAttachmentOwnershipClaim, SessionAttachmentRagMaintenanceScope } from '../types'

export type AttachmentOwnershipTransfer = {
  attachmentId: number
  messageId: string
}

export type AttachmentOwnershipRow = {
  id: number
  sessionId: string
  messageId: string
}

export type OrphanCleanupPlan = {
  deleteIds: number[]
  repairs: SessionAttachmentOwnershipClaim[]
}

/**
 * Save & Resend versioning copies a user message inside one session, so
 * several live messages can reference the same indexed attachment row while
 * the row itself stays owned by (message_id =) a single message. Plan the
 * rebinds that must run before the `removed` messages take their rows down
 * with them: every attachment referenced by a removed message and by a
 * survivor is handed to that survivor, while rows nobody references any more
 * keep their owner and stay eligible for deletion / orphan maintenance.
 *
 * `survivors` may include the removed messages themselves (callers typically
 * pass the full pre-removal message universe); they are ignored as transfer
 * targets.
 */
export function planAttachmentOwnershipTransfers(
  removed: Message[],
  survivors: Message[]
): AttachmentOwnershipTransfer[] {
  const removedMessageIds = new Set(removed.map((message) => message.id))
  const removedAttachmentIds = new Set<number>()
  for (const message of removed) {
    for (const file of message.files ?? []) {
      if (typeof file.sessionAttachmentId === 'number') {
        removedAttachmentIds.add(file.sessionAttachmentId)
      }
    }
  }
  if (removedAttachmentIds.size === 0) {
    return []
  }

  const transfers = new Map<number, string>()
  for (const message of survivors) {
    if (removedMessageIds.has(message.id)) {
      continue
    }
    for (const file of message.files ?? []) {
      const attachmentId = file.sessionAttachmentId
      if (typeof attachmentId === 'number' && removedAttachmentIds.has(attachmentId) && !transfers.has(attachmentId)) {
        transfers.set(attachmentId, message.id)
      }
    }
  }
  return Array.from(transfers, ([attachmentId, messageId]) => ({ attachmentId, messageId }))
}

/**
 * Every attachment id a session's live messages still reference, paired with
 * the message that can own it. Collected across all sessions, these claims let
 * an orphan sweep place a row whose recorded owner has disappeared.
 */
export function collectAttachmentOwnershipClaims(
  sessionId: string,
  messages: Message[]
): SessionAttachmentOwnershipClaim[] {
  const claims = new Map<number, SessionAttachmentOwnershipClaim>()
  for (const message of messages) {
    for (const file of message.files ?? []) {
      const attachmentId = file.sessionAttachmentId
      if (typeof attachmentId === 'number' && !claims.has(attachmentId)) {
        claims.set(attachmentId, { attachmentId, sessionId, messageId: message.id })
      }
    }
  }
  return Array.from(claims.values())
}

/**
 * Decide what an orphan sweep does with each indexed attachment row. A row is
 * only deleted once nothing reaches it: an unreachable owner alone is not
 * enough, because Save & Resend versioning copies a `sessionAttachmentId` into
 * a replacement message, so deleting the original prompt can leave a live
 * message pointing at a row owned by a dead one. Such rows are rebound to the
 * message that still claims them, which also repairs ownership when the rebind
 * at removal time never landed.
 */
export function planOrphanCleanup(
  rows: AttachmentOwnershipRow[],
  scope: SessionAttachmentRagMaintenanceScope
): OrphanCleanupPlan {
  const liveSessionIds = new Set(scope.sessionIds)
  const liveMessageIds = new Set(scope.messageIds)

  const claims = new Map<number, SessionAttachmentOwnershipClaim>()
  for (const claim of scope.attachmentReferences) {
    if (!claims.has(claim.attachmentId) && liveSessionIds.has(claim.sessionId) && liveMessageIds.has(claim.messageId)) {
      claims.set(claim.attachmentId, claim)
    }
  }

  const deleteIds: number[] = []
  const repairs: SessionAttachmentOwnershipClaim[] = []
  for (const row of rows) {
    if (liveSessionIds.has(row.sessionId) && liveMessageIds.has(row.messageId)) {
      continue
    }
    const claim = claims.get(row.id)
    if (claim) {
      repairs.push(claim)
      continue
    }
    deleteIds.push(row.id)
  }
  return { deleteIds, repairs }
}
