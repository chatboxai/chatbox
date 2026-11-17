import { sessionRepository } from '@/app/renderer-application'
import platform from '@/platform'

/** Repair surviving owners before deleting an obsolete message's attachment rows. */
export async function cleanupSessionAttachments(sessionId: string, removedMessageId?: string): Promise<void> {
  if (!platform.isDesktopLike) return
  try {
    const ownership = await sessionRepository.collectSessionAttachmentOwnership(sessionId)
    const controller = platform.getSessionAttachmentRagController()
    for (const reference of ownership.attachmentReferences) await controller.rebindAttachment(reference)
    if (removedMessageId) await controller.deleteMessageAttachments(removedMessageId)
  } catch (error) {
    console.warn('Failed to reconcile session attachment ownership:', error)
  }
}
