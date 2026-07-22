import type { SyncCryptoEnvelope } from './types'

const ENVELOPE_VERSION = 1
const PBKDF2_ITERATIONS = 250_000
const SALT_BYTES = 16
const IV_BYTES = 12
const AES_GCM_TAG_BYTES = 16
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

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

function invalidEnvelope(reason: string): never {
  throw new Error(`Invalid sync encryption envelope: ${reason}`)
}

function decodeEnvelopeField(value: unknown, field: string, expectedBytes?: number): Uint8Array {
  if (typeof value !== 'string' || !BASE64_PATTERN.test(value)) {
    invalidEnvelope(`${field} must be canonical Base64`)
  }
  if (expectedBytes !== undefined && value.length !== Math.ceil(expectedBytes / 3) * 4) {
    invalidEnvelope(`${field} must decode to ${expectedBytes} bytes`)
  }
  let decoded: Uint8Array
  try {
    decoded = base64ToBytes(value)
  } catch {
    return invalidEnvelope(`${field} must be canonical Base64`)
  }
  if (bytesToBase64(decoded) !== value) {
    invalidEnvelope(`${field} must be canonical Base64`)
  }
  if (expectedBytes !== undefined && decoded.byteLength !== expectedBytes) {
    invalidEnvelope(`${field} must decode to ${expectedBytes} bytes`)
  }
  return decoded
}

function validateEnvelope(envelope: SyncCryptoEnvelope): {
  salt: Uint8Array
  iv: Uint8Array
  ciphertext: Uint8Array
} {
  const candidate = envelope as Partial<SyncCryptoEnvelope> | null
  if (!candidate || typeof candidate !== 'object') {
    invalidEnvelope('expected an object')
  }
  if (candidate.version !== ENVELOPE_VERSION || candidate.kdf !== 'PBKDF2-SHA256' || candidate.cipher !== 'AES-GCM') {
    throw new Error('Unsupported sync encryption envelope')
  }
  if (candidate.iterations !== PBKDF2_ITERATIONS) {
    invalidEnvelope(`iterations must equal ${PBKDF2_ITERATIONS}`)
  }

  const salt = decodeEnvelopeField(candidate.salt, 'salt', SALT_BYTES)
  const iv = decodeEnvelopeField(candidate.iv, 'iv', IV_BYTES)
  const ciphertext = decodeEnvelopeField(candidate.ciphertext, 'ciphertext')
  if (ciphertext.byteLength < AES_GCM_TAG_BYTES) {
    invalidEnvelope(`ciphertext must include a ${AES_GCM_TAG_BYTES}-byte authentication tag`)
  }
  return { salt, iv, ciphertext }
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
  const { salt, iv, ciphertext } = validateEnvelope(envelope)

  try {
    const cryptoImpl = getCrypto()
    const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS)
    const decrypted = await cryptoImpl.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext)
    )
    return JSON.parse(new TextDecoder().decode(decrypted)) as T
  } catch (error) {
    throw new Error(`Failed to decrypt sync data: ${error instanceof Error ? error.message : String(error)}`)
  }
}
