import type { BlobStoragePort } from '@chatbox/core/ports'
import storage from '@/storage'

export interface CurrentBlobStorageBackend {
  getBlob(key: string): Promise<string | null>
  setBlob(key: string, value: string): Promise<void>
  delBlob(key: string): Promise<void>
  getBlobKeys(): Promise<string[]>
}

/**
 * Preserves the current blob key space and delegates every operation to the
 * existing Renderer storage singleton.
 */
export class CurrentBlobStorage implements BlobStoragePort {
  constructor(private readonly backend: CurrentBlobStorageBackend = storage) {}

  get(key: string): Promise<string | null> {
    return this.backend.getBlob(key)
  }

  set(key: string, value: string): Promise<void> {
    return this.backend.setBlob(key, value)
  }

  remove(key: string): Promise<void> {
    return this.backend.delBlob(key)
  }

  keys(): Promise<string[]> {
    return this.backend.getBlobKeys()
  }
}
