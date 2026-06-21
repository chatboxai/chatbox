import { describe, expect, it } from 'vitest'
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
})
