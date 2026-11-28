import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'

const iterations = 600_000
const aad = new TextEncoder().encode('ChatAny Sync E2EE v1')

function bytes(value: ArrayLike<number>): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value)
}
function join(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

export interface NodeEncryptedEnvelope {
  format: 'chatany-sync-e2ee'
  version: 1
  kdf: { name: 'PBKDF2-SHA-256'; iterations: number; salt: string }
  cipher: { name: 'AES-256-GCM'; iv: string; ciphertext: string }
}

export function encryptBytes(plaintext: Uint8Array, token: string): NodeEncryptedEnvelope {
  if (!token) throw new Error('encryption_token_required')
  const salt = bytes(randomBytes(16))
  const iv = bytes(randomBytes(12))
  const key = bytes(pbkdf2Sync(token, salt, iterations, 32, 'sha256'))
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad)
  const body = join([
    bytes(cipher.update(new Uint8Array(plaintext))),
    bytes(cipher.final()),
    bytes(cipher.getAuthTag()),
  ])
  return {
    format: 'chatany-sync-e2ee',
    version: 1,
    kdf: { name: 'PBKDF2-SHA-256', iterations, salt: Buffer.from(salt).toString('base64') },
    cipher: {
      name: 'AES-256-GCM',
      iv: Buffer.from(iv).toString('base64'),
      ciphertext: Buffer.from(body).toString('base64'),
    },
  }
}

export function decryptBytes(envelope: NodeEncryptedEnvelope, token: string): Uint8Array {
  if (!token) throw new Error('encryption_token_required')
  if (envelope.format !== 'chatany-sync-e2ee' || envelope.version !== 1 || envelope.kdf.iterations !== iterations)
    throw new Error('unsupported_encrypted_sync_payload')
  const salt = bytes(Buffer.from(envelope.kdf.salt, 'base64'))
  const iv = bytes(Buffer.from(envelope.cipher.iv, 'base64'))
  const body = bytes(Buffer.from(envelope.cipher.ciphertext, 'base64'))
  const tag = body.subarray(body.length - 16)
  const key = bytes(pbkdf2Sync(token, salt, iterations, 32, 'sha256'))
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  return join([bytes(decipher.update(body.subarray(0, -16))), bytes(decipher.final())])
}
