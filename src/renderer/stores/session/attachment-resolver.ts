import type { AttachmentResolver } from '@shared/context/types'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'

/**
 * Create an AttachmentResolver backed by the app's storage layer
 * Used by orchestration to inject storage dependency into shared buildContext()
 */
export function createAttachmentResolver(): AttachmentResolver {
  return {
    read(attachmentId: string): Promise<string | null> {
      return currentBlobStorage.get(attachmentId).catch(() => null)
    },
  }
}
