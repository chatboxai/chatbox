import { throwIfAborted } from '../utils/abort'
import { type ByteSource, readFileBytes } from './byte-source'

const BLOCK_BYTES = 64 * 1024
const MAX_BLOCKS = 4
const READ_AHEAD_BYTES = 1024 * 1024
const MAX_READ_AHEAD_BLOCKS = 2

/** Scan-local raw bytes: 256 KiB of headers plus at most 2 MiB of body read-ahead. */
export function cacheFileRanges(file: ByteSource, signal?: AbortSignal) {
  const blocks = new Map<number, Uint8Array>()
  const readAheadBlocks = new Map<number, Uint8Array>()
  function evict(cache: Map<number, Uint8Array>, capacity: number): void {
    const oldest = cache.keys().next()
    if (cache.size >= capacity && !oldest.done) cache.delete(oldest.value)
  }
  async function read(offset: number, length: number, readAhead: boolean): Promise<Uint8Array> {
    throwIfAborted(signal)
    // Preserve the range contract even when every requested byte is cached.
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size)
      throw new Error('File read offset is invalid')
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('File read length is invalid')
    const result = new Uint8Array(Math.min(length, file.size - offset))
    for (let written = 0; written < result.length; ) {
      throwIfAborted(signal)
      const position = offset + written
      const readAheadStart = Math.floor(position / READ_AHEAD_BYTES) * READ_AHEAD_BYTES
      const useReadAhead = readAheadBlocks.has(readAheadStart) || (readAhead && length >= BLOCK_BYTES)
      const cache = useReadAhead ? readAheadBlocks : blocks
      const blockBytes = useReadAhead ? READ_AHEAD_BYTES : BLOCK_BYTES
      const capacity = useReadAhead ? MAX_READ_AHEAD_BLOCKS : MAX_BLOCKS
      const start = Math.floor(position / blockBytes) * blockBytes
      let block = cache.get(start)
      if (block) {
        cache.delete(start)
      } else {
        // Evict before allocation. Recheck on insertion for overlapping readers.
        evict(cache, capacity)
        block = await readFileBytes(file, start, Math.min(blockBytes, file.size - start))
        throwIfAborted(signal)
      }
      evict(cache, capacity)
      cache.set(start, block)
      const localOffset = position - start
      const count = Math.min(result.length - written, block.length - localOffset)
      result.set(block.subarray(localOffset, localOffset + count), written)
      written += count
    }
    return result
  }
  return {
    size: file.size,
    readBytes: (offset: number, length: number) => read(offset, length, false),
    /** Full input chunks opt in; short payloads keep the small header-read policy. */
    readAheadBytes: (offset: number, length: number) => read(offset, length, true),
  }
}
