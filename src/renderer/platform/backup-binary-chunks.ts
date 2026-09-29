/** 256 KiB of binary stays within the 384 KiB soft bridge budget once base64 encoded. */
const BRIDGE_WRITE_BYTES = 256 * 1024

/** Coalesce upstream ZIP chunks into bounded native bridge writes. */
export async function* backupBinaryChunks(chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
  let total = 0
  const buffer = new Uint8Array(BRIDGE_WRITE_BYTES)
  let used = 0
  for await (const chunk of chunks) {
    total += chunk.length
    if (total > 4 * 1024 ** 3) throw new Error('Backup exceeds file size budget')
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
