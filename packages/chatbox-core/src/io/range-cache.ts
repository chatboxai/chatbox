import { throwIfAborted } from '../utils/abort'
import { type ByteSource, readFileBytes } from './byte-source'

const BLOCK_BYTES = 64 * 1024
const MAX_BLOCKS = 4

/** A scan-local, 256 KiB cache of raw file bytes. Callers receive independent copies. */
export function cacheFileRanges(file: ByteSource, signal?: AbortSignal): ByteSource {
  const blocks = new Map<number, Uint8Array>()
  return {
    size: file.size,
    async readBytes(offset, length) {
      throwIfAborted(signal)
      // Preserve the range contract even when every requested byte is cached.
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size)
        throw new Error('File read offset is invalid')
      if (!Number.isSafeInteger(length) || length < 0) throw new Error('File read length is invalid')
      const result = new Uint8Array(Math.min(length, file.size - offset))
      for (let written = 0; written < result.length; ) {
        throwIfAborted(signal)
        const position = offset + written
        const start = Math.floor(position / BLOCK_BYTES) * BLOCK_BYTES
        let block = blocks.get(start)
        if (block) {
          blocks.delete(start)
        } else {
          // Evict before reading so a miss does not retain a fifth block.
          if (blocks.size === MAX_BLOCKS) blocks.delete(blocks.keys().next().value!)
          block = await readFileBytes(file, start, Math.min(BLOCK_BYTES, file.size - start))
          throwIfAborted(signal)
        }
        blocks.set(start, block)
        const localOffset = position - start
        const count = Math.min(result.length - written, block.length - localOffset)
        result.set(block.subarray(localOffset, localOffset + count), written)
        written += count
      }
      return result
    },
  }
}
