/** Bound each native bridge write independently of upstream ZIP chunk sizes. */
export async function* backupBinaryChunks(chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
  let total = 0
  for await (const chunk of chunks) {
    total += chunk.length
    if (total > 4 * 1024 ** 3) throw new Error('Backup exceeds file size budget')
    for (let offset = 0; offset < chunk.length; offset += 65536) {
      signal?.throwIfAborted()
      yield chunk.subarray(offset, offset + 65536)
    }
  }
  signal?.throwIfAborted()
}
