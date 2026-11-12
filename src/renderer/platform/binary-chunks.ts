import { throwIfAborted } from '@chatbox/core/utils/abort'

/** 256 KiB of binary stays within the 384 KiB soft bridge budget once base64 encoded. */
const BRIDGE_WRITE_BYTES = 256 * 1024

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}

/** Coalesce upstream byte chunks into bounded native bridge writes. */
export async function* binaryChunks(chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
  throwIfAborted(signal)
  let total = 0
  const buffer = new Uint8Array(BRIDGE_WRITE_BYTES)
  let used = 0
  for await (const chunk of chunks) {
    total += chunk.length
    if (total > 4 * 1024 ** 3) throw new Error('File exceeds file size budget')
    for (let offset = 0; offset < chunk.length; ) {
      signal?.throwIfAborted()
      const count = Math.min(chunk.length - offset, BRIDGE_WRITE_BYTES - used)
      buffer.set(chunk.subarray(offset, offset + count), used)
      used += count
      offset += count
      if (used === BRIDGE_WRITE_BYTES) {
        yield buffer.slice()
        used = 0
      }
    }
  }
  signal?.throwIfAborted()
  if (used > 0) yield buffer.slice(0, used)
}
