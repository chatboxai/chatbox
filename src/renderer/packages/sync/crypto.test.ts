import { describe, expect, it, vi } from 'vitest'
import { decryptJsonEnvelope, encryptJsonEnvelope } from './crypto'

describe('sync crypto envelope', () => {
  it('round trips JSON with the sync password', async () => {
    const payload = { version: 1, sessions: [{ id: 's1', name: 'Hello' }] }

    const envelope = await encryptJsonEnvelope(payload, 'correct horse battery staple')
    const decrypted = await decryptJsonEnvelope(envelope, 'correct horse battery staple')

    expect(envelope.version).toBe(1)
    expect(envelope.kdf).toBe('PBKDF2-SHA256')
    expect(envelope.ciphertext).not.toContain('Hello')
    expect(decrypted).toEqual(payload)
  })

  it('rejects a wrong sync password', async () => {
    const envelope = await encryptJsonEnvelope({ secret: 'chat history' }, 'right-password')

    await expect(decryptJsonEnvelope(envelope, 'wrong-password')).rejects.toThrow(/decrypt/i)
  })

  it('rejects an unexpected PBKDF2 iteration count before deriving a key', async () => {
    const envelope = await encryptJsonEnvelope({ secret: 'chat history' }, 'right-password')
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey')

    try {
      await expect(decryptJsonEnvelope({ ...envelope, iterations: 4_000_000_000 }, 'right-password')).rejects.toThrow(
        /iterations must equal 250000/i
      )
      expect(deriveKey).not.toHaveBeenCalled()
    } finally {
      deriveKey.mockRestore()
    }
  })

  it('validates Base64 fields and fixed salt and IV lengths before deriving a key', async () => {
    const envelope = await encryptJsonEnvelope({ secret: 'chat history' }, 'right-password')

    await expect(decryptJsonEnvelope({ ...envelope, salt: 'not-base64!' }, 'right-password')).rejects.toThrow(
      /salt must be canonical Base64/i
    )
    await expect(decryptJsonEnvelope({ ...envelope, salt: btoa('\0'.repeat(15)) }, 'right-password')).rejects.toThrow(
      /salt must decode to 16 bytes/i
    )
    await expect(decryptJsonEnvelope({ ...envelope, iv: btoa('\0'.repeat(11)) }, 'right-password')).rejects.toThrow(
      /iv must decode to 12 bytes/i
    )
    await expect(decryptJsonEnvelope({ ...envelope, ciphertext: '***' }, 'right-password')).rejects.toThrow(
      /ciphertext must be canonical Base64/i
    )
    const nonCanonicalSalt = `${btoa('\0'.repeat(16)).slice(0, -3)}B==`
    await expect(decryptJsonEnvelope({ ...envelope, salt: nonCanonicalSalt }, 'right-password')).rejects.toThrow(
      /salt must be canonical Base64/i
    )
  })
})
