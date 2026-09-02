import type { PickedAsset, PickedAssetContentPort } from '@chatbox/core/application/attachments'
import { getFileUniqKey } from '@/storage/file-uniq-key'

/**
 * Converts DOM File values at the Renderer boundary and keeps the actual File
 * private while an AttachmentService operation is in flight.
 */
export class BrowserAttachmentAdapter implements PickedAssetContentPort {
  private readonly files = new WeakMap<PickedAsset, File>()

  constructor(private readonly resolveUri: (file: File) => string = () => '') {}

  fromFile(file: File): PickedAsset {
    // Preserve the historical storage key before native-path resolution mutates
    // any host-side metadata remembered on the File.
    const id = getFileUniqKey(file)
    const uri = this.resolveUri(file) || file.path || file.name
    const asset: PickedAsset = {
      id,
      uri,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      lastModified: file.lastModified,
    }
    this.files.set(asset, file)
    return asset
  }

  getFile(asset: PickedAsset): File {
    const file = this.files.get(asset)
    if (!file) {
      throw new Error(`Picked asset is no longer available: ${asset.id}`)
    }
    return file
  }

  async readBytes(asset: PickedAsset): Promise<Uint8Array> {
    return new Uint8Array(await this.getFile(asset).arrayBuffer())
  }

  async readDataUrl(asset: PickedAsset): Promise<string> {
    const bytes = await this.readBytes(asset)
    const chunks: string[] = []
    const chunkSize = 8192
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length))
      chunks.push(String.fromCharCode(...chunk))
    }
    return `data:${asset.mimeType || 'application/octet-stream'};base64,${btoa(chunks.join(''))}`
  }

  release(asset: PickedAsset): void {
    this.files.delete(asset)
  }
}
