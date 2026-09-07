import type { StorageAdapter } from '@shared/types/adapters'

export interface ModelBlobStorage {
  setBlob(key: string, value: string): Promise<void>
  getBlob(key: string): Promise<string | null>
}

/**
 * Adapts the host blob store to the image storage contract expected by models.
 */
export class RendererModelStorageAdapter implements StorageAdapter {
  constructor(
    private readonly blobStorage: ModelBlobStorage,
    private readonly createPictureStorageKey: (folder: string) => string
  ) {}

  async saveImage(folder: string, dataUrl: string): Promise<string> {
    const storageKey = this.createPictureStorageKey(folder)
    await this.blobStorage.setBlob(storageKey, dataUrl)
    return storageKey
  }

  async getImage(keyOrUrl: string): Promise<string> {
    if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
      return keyOrUrl
    }
    const blob = await this.blobStorage.getBlob(keyOrUrl)
    if (!blob) return ''
    return blob.startsWith('data:') ? blob : `data:image/png;base64,${blob}`
  }
}
