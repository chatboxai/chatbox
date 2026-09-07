import { describe, expect, test } from 'vitest'
import { readFileHandleBytesBounded } from './bounded-file-read'

describe('readFileHandleBytesBounded', () => {
  test('stops at maxBytes + 1 when the file grows after its initial stat', async () => {
    const contents = Buffer.from('grew after stat')
    let sourceOffset = 0
    let requestedBytes = 0
    const file = {
      read(buffer: Uint8Array<ArrayBuffer>, offset: number, length: number, _position: null) {
        requestedBytes += length
        const bytesRead = Math.min(length, contents.length - sourceOffset)
        buffer.set(contents.subarray(sourceOffset, sourceOffset + bytesRead), offset)
        sourceOffset += bytesRead
        return Promise.resolve({ bytesRead })
      },
    }

    await expect(readFileHandleBytesBounded(file, 4, 1)).resolves.toEqual({
      success: false,
      reason: 'too-large',
      maxBytes: 4,
    })
    expect(requestedBytes).toBe(5)
  })

  test('returns all bytes when the opened file reaches EOF within the limit', async () => {
    const contents = Buffer.from('image')
    let sourceOffset = 0
    const file = {
      read(buffer: Uint8Array<ArrayBuffer>, offset: number, length: number, _position: null) {
        const bytesRead = Math.min(length, contents.length - sourceOffset)
        buffer.set(contents.subarray(sourceOffset, sourceOffset + bytesRead), offset)
        sourceOffset += bytesRead
        return Promise.resolve({ bytesRead })
      },
    }

    const result = await readFileHandleBytesBounded(file, 10, contents.length)
    expect(result.success).toBe(true)
    if (result.success) expect(result.bytes.toString()).toBe('image')
  })
})
