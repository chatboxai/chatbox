import type { BackupChecksum, BackupResourceEntry } from './types'

const MIME_EXTENSION: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'text/html': 'html',
  'text/markdown': 'md',
  'text/plain': 'txt',
}

const DATA_URL_BASE64_PATTERN = /^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]*)$/i

export interface StoredBlobHint {
  mimeType?: string
  filename?: string
}

export interface EncodedStoredBlob {
  bytes: Uint8Array
  encoding: BackupResourceEntry['encoding']
  mimeType: string
  extension: string
}

export type Sha256Digest = (bytes: Uint8Array) => Promise<ArrayBuffer>

interface CryptoWithSubtleDigest {
  subtle?: {
    digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer>
  }
}

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, '')
  const binary = globalThis.atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  const chunkSize = 3 * 16_384
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    let binary = ''
    for (let index = 0; index < chunk.length; index++) {
      binary += String.fromCharCode(chunk[index])
    }
    parts.push(globalThis.btoa(binary))
  }
  return parts.join('')
}

function extensionFromFilename(filename?: string): string | undefined {
  const match = filename?.toLowerCase().match(/\.([a-z0-9]{1,10})$/)
  return match?.[1]
}

export function encodeStoredBlob(value: string, hint: StoredBlobHint = {}): EncodedStoredBlob {
  const dataUrlMatch = value.match(DATA_URL_BASE64_PATTERN)
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1].toLowerCase()
    return {
      bytes: base64ToBytes(dataUrlMatch[2]),
      encoding: 'data-url-base64',
      mimeType,
      extension: MIME_EXTENSION[mimeType] || extensionFromFilename(hint.filename) || 'bin',
    }
  }

  const mimeType = hint.mimeType || 'text/plain'
  return {
    bytes: new TextEncoder().encode(value),
    encoding: 'utf8',
    mimeType,
    extension: MIME_EXTENSION[mimeType] || extensionFromFilename(hint.filename) || 'txt',
  }
}

export function decodeStoredBlob(
  bytes: Uint8Array,
  encoding: BackupResourceEntry['encoding'],
  mimeType: string
): string {
  if (encoding === 'data-url-base64') {
    return `data:${mimeType};base64,${bytesToBase64(bytes)}`
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function webSha256Digest(bytes: Uint8Array): Promise<ArrayBuffer> {
  const subtle = (globalThis as { crypto?: CryptoWithSubtleDigest }).crypto?.subtle
  if (!subtle) throw new Error('SHA-256 is not available on this platform')
  return subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
}

export async function sha256Checksum(
  bytes: Uint8Array,
  digest: Sha256Digest = webSha256Digest
): Promise<BackupChecksum> {
  const digestBytes = new Uint8Array(await digest(bytes))
  if (digestBytes.byteLength !== 32) throw new Error('SHA-256 returned an invalid digest')
  const value = Array.from(digestBytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return { algorithm: 'sha256', value }
}

export function shouldCompressMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'image/svg+xml'
  )
}
