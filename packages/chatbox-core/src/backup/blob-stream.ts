import { sha256 } from '@noble/hashes/sha2.js'
import { throwIfAborted } from './abort'
import { base64ToBytes, bytesToBase64, encodeStoredBlob, type StoredBlobHint } from './codec'
import {
  MAX_BACKUP_RESOURCE_ENTRY_BYTES,
  type BackupChecksum,
  type BackupResourceEntry,
  type BackupStorage,
} from './types'

export const RESOURCE_STRING_CHARS = 16 * 1024
const encoder = new TextEncoder()
export function resourceHash() {
  const hash = sha256.create()
  let size = 0
  return {
    write(bytes: Uint8Array) {
      size += bytes.length
      if (size > MAX_BACKUP_RESOURCE_ENTRY_BYTES) throw new Error('Managed resource exceeds the backup size limit')
      hash.update(bytes)
    },
    finish(): { size: number; checksum: BackupChecksum } {
      return {
        size,
        checksum: {
          algorithm: 'sha256',
          value: Array.from(hash.digest(), (b) => b.toString(16).padStart(2, '0')).join(''),
        },
      }
    },
  }
}

export async function* decodeBase64Chunks(source: AsyncIterable<string>): AsyncGenerator<Uint8Array> {
  let pending = ''
  let ended = false
  for await (const text of source) {
    if (text.length > 65536) throw new Error('Resource source string exceeds budget')
    const value = text.replace(/\s/g, '')
    if (ended && value) throw new Error('Invalid trailing resource base64')
    pending += value
    const length = pending.length - (pending.length % 4)
    if (length) {
      const encoded = pending.slice(0, length)
      ended = encoded.includes('=')
      const bytes = base64ToBytes(encoded)
      for (let i = 0; i < bytes.length; i += RESOURCE_STRING_CHARS) yield bytes.subarray(i, i + RESOURCE_STRING_CHARS)
      pending = pending.slice(length)
      if (ended && pending) throw new Error('Invalid trailing resource base64')
    }
  }
  if (pending) yield base64ToBytes(pending)
}

export async function* encodeBase64Chunks(source: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  let carry = new Uint8Array(0)
  for await (const part of source) {
    for (let offset = 0; offset < part.length; offset += RESOURCE_STRING_CHARS) {
      const slice = part.subarray(offset, offset + RESOURCE_STRING_CHARS)
      const value = new Uint8Array(carry.length + slice.length)
      value.set(carry)
      value.set(slice, carry.length)
      const length = value.length - (value.length % 3)
      if (length) yield bytesToBase64(value.subarray(0, length))
      carry = value.slice(length)
    }
  }
  if (carry.length) yield bytesToBase64(carry)
}

export async function* encodeResourceText(source: AsyncIterable<string>): AsyncGenerator<Uint8Array> {
  let carry = ''
  for await (const text of source) {
    if (text.length > 65536) throw new Error('Resource source string exceeds budget')
    const value = carry + text
    carry = ''
    for (let i = 0; i < value.length; ) {
      let end = Math.min(i + RESOURCE_STRING_CHARS, value.length)
      const code = value.charCodeAt(end - 1)
      if (code >= 0xd800 && code <= 0xdbff) end--
      if (end === i) {
        carry = value.slice(i)
        break
      }
      yield encoder.encode(value.slice(i, end))
      i = end
    }
  }
  if (carry) yield encoder.encode(carry)
}

export function resourceExists(storage: BackupStorage, key: string): Promise<boolean> {
  return storage.blobStreams ? storage.blobStreams.has(key) : storage.getBlob(key).then((value) => value !== null)
}

export async function readResource(storage: BackupStorage, key: string, hint: StoredBlobHint = {}) {
  if (!storage.blobStreams) {
    const value = await storage.getBlob(key)
    if (value === null) return null
    const encoded = encodeStoredBlob(value, hint)
    return {
      ...encoded,
      chunks: (async function* () {
        for (let i = 0; i < encoded.bytes.length; i += RESOURCE_STRING_CHARS)
          yield encoded.bytes.subarray(i, i + RESOURCE_STRING_CHARS)
      })(),
    }
  }
  const source = await storage.blobStreams.read(key)
  if (source === null) return null
  const iterator = source[Symbol.asyncIterator]()
  let prefix = ''
  let tail = ''
  try {
    while (prefix.length < 1024 && !prefix.includes(',')) {
      const next = await iterator.next()
      if (next.done) break
      if (next.value.length > 65536) throw new Error('Resource source string exceeds budget')
      const count = Math.min(next.value.length, 1024 - prefix.length)
      prefix += next.value.slice(0, count)
      tail = next.value.slice(count)
      if (prefix.length >= 5 && !prefix.toLowerCase().startsWith('data:')) break
    }
    const match = prefix.match(/^data:([^;,]+)(?:;[^,]*)?;base64,/i)
    if (!match && /^data:/i.test(prefix) && !prefix.includes(',') && prefix.length === 1024)
      throw new Error('Resource data URL header exceeds budget')
    const meta = encodeStoredBlob(match ? match[0] : '', hint)
    const text = (async function* () {
      try {
        yield prefix.slice(match?.[0].length ?? 0)
        if (tail) yield tail
        for (;;) {
          const next = await iterator.next()
          if (next.done) break
          yield next.value
        }
      } finally {
        await iterator.return?.()
      }
    })()
    return {
      encoding: meta.encoding,
      mimeType: meta.mimeType,
      extension: meta.extension,
      chunks: match ? decodeBase64Chunks(text) : encodeResourceText(text),
    }
  } catch (error) {
    await iterator.return?.()
    throw error
  }
}

export async function fingerprintResource(
  storage: BackupStorage,
  key: string,
  hint: StoredBlobHint = {},
  signal?: AbortSignal
) {
  throwIfAborted(signal)
  const resource = await readResource(storage, key, hint)
  if (!resource) return null
  const hash = resourceHash()
  for await (const bytes of resource.chunks) {
    throwIfAborted(signal)
    hash.write(bytes)
  }
  throwIfAborted(signal)
  return { encoding: resource.encoding, mimeType: resource.mimeType, extension: resource.extension, ...hash.finish() }
}

export async function* storedResourceChunks(
  bytes: AsyncIterable<Uint8Array>,
  resource: Pick<BackupResourceEntry, 'encoding' | 'mimeType'>
): AsyncGenerator<string> {
  if (resource.encoding === 'data-url-base64') {
    yield `data:${resource.mimeType};base64,`
    yield* encodeBase64Chunks(bytes)
  } else {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    for await (const chunk of bytes) {
      for (let i = 0; i < chunk.length; i += RESOURCE_STRING_CHARS) {
        const text = decoder.decode(chunk.subarray(i, i + RESOURCE_STRING_CHARS), { stream: true })
        if (text) yield text
      }
    }
    const tail = decoder.decode()
    if (tail) yield tail
  }
}
