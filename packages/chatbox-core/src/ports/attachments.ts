/**
 * Host-independent attachment metadata used by application services.
 *
 * Native File/Blob objects stay in host adapters and are represented here by
 * durable storage keys.
 */
export interface AttachmentDescriptor {
  id: string
  name: string
  storageKey: string
  rawStorageKey?: string
  mediaType?: string
  byteLength?: number
}

export interface AttachmentContentPort {
  read(storageKey: string): Promise<string | null>
}
