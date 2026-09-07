import type { AttachmentContentPort, BlobStoragePort } from '@chatbox/core/ports'
import { CurrentBlobStorage } from './CurrentBlobStorage'

/**
 * Attachment content resolver backed by the current blob store. Read failures
 * retain the existing AttachmentResolver behavior and resolve to null.
 */
export class CurrentAttachmentAdapter implements AttachmentContentPort {
  constructor(private readonly blobStorage: Pick<BlobStoragePort, 'get'> = new CurrentBlobStorage()) {}

  read(storageKey: string): Promise<string | null> {
    return this.blobStorage.get(storageKey).catch(() => null)
  }
}
