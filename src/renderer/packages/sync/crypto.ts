import type { SyncCryptoEnvelope } from './types'

const ENVELOPE_VERSION = 1
const PBKDF2_ITERATIONS = 250_000
const SALT_BYTES = 16
const IV_BYTES = 12

function getCrypto(): Crypto {
  const cryptoImpl = globalThis.crypto
  if (!cryptoImpl?.subtle) {
    throw new Error('Web Crypto is not available')
  }
  return cryptoImpl
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (!password) {
    throw new Error('Sync password is required')
  }
  const cryptoImpl = getCrypto()
  const passwordKey = await cryptoImpl.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return cryptoImpl.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations,
    },
    passwordKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptJsonEnvelope<T>(payload: T, password: string): Promise<SyncCryptoEnvelope> {
  const cryptoImpl = getCrypto()
  const salt = cryptoImpl.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = cryptoImpl.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS)
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, plaintext)

  return {
    version: ENVELOPE_VERSION,
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-GCM',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

export async function decryptJsonEnvelope<T = unknown>(envelope: SyncCryptoEnvelope, password: string): Promise<T> {
  if (envelope.version !== ENVELOPE_VERSION || envelope.kdf !== 'PBKDF2-SHA256' || envelope.cipher !== 'AES-GCM') {
    throw new Error('Unsupported sync encryption envelope')
  }

  try {
    const cryptoImpl = getCrypto()
    const salt = base64ToBytes(envelope.salt)
    const iv = base64ToBytes(envelope.iv)
    const key = await deriveAesKey(password, salt, envelope.iterations)
    const decrypted = await cryptoImpl.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(base64ToBytes(envelope.ciphertext))
    )
    return JSON.parse(new TextDecoder().decode(decrypted)) as T
  } catch (error) {
    throw new Error(`Failed to decrypt sync data: ${error instanceof Error ? error.message : String(error)}`)
  }
}
