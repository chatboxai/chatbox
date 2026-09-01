import { describe, expect, it } from 'vitest'
import { decodeStoredBlob, encodeStoredBlob, sha256Checksum } from './codec'

describe('backup resource codec', () => {
  it('round-trips UTF-8 blob values', () => {
    const encoded = encodeStoredBlob('你好, Chatbox')
    expect(encoded.encoding).toBe('utf8')
    expect(decodeStoredBlob(encoded.bytes, encoded.encoding, encoded.mimeType)).toBe('你好, Chatbox')
  })

  it('stores data URLs as their original binary bytes', () => {
    const value = 'data:image/png;base64,AAECA/8='
    const encoded = encodeStoredBlob(value)
    expect(encoded).toMatchObject({ encoding: 'data-url-base64', mimeType: 'image/png', extension: 'png' })
    expect(Array.from(encoded.bytes)).toEqual([0, 1, 2, 3, 255])
    expect(decodeStoredBlob(encoded.bytes, encoded.encoding, encoded.mimeType)).toBe(value)
  })

  it('produces a stable SHA-256 checksum', async () => {
    const checksum = await sha256Checksum(new TextEncoder().encode('chatbox'))
    expect(checksum).toEqual({
      algorithm: 'sha256',
      value: '34a3be81f9446ab48383356a82763fcf93a08a667d01f77a554392821a7893ce',
    })
  })

  it('supports a platform SHA-256 provider without Web Crypto', async () => {
    const digest = new Uint8Array(32).fill(0xab)
    const checksum = await sha256Checksum(new Uint8Array([1, 2, 3]), () => Promise.resolve(digest.buffer))

    expect(checksum).toEqual({ algorithm: 'sha256', value: 'ab'.repeat(32) })
  })
})
