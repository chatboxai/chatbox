import { describe, expect, it } from 'vitest'
import { decryptBytes, encryptBytes } from './e2ee-node'

describe('main-process sync encryption', () => {
  it('round trips binary backup data', () => {
    const source = Uint8Array.from([0, 1, 2, 127, 128, 255])
    const encrypted = encryptBytes(source, 'correct horse battery staple')
    expect(encrypted.cipher.ciphertext).not.toContain(Buffer.from(source).toString('base64'))
    expect(decryptBytes(encrypted, 'correct horse battery staple')).toEqual(source)
  })

  it('rejects a wrong token', () => {
    const encrypted = encryptBytes(new TextEncoder().encode('secret'), 'right-token')
    expect(() => decryptBytes(encrypted, 'wrong-token')).toThrow()
  })
})
