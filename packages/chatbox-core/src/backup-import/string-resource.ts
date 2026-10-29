import { throwIfAborted } from '../utils/abort'
import type { LegacyResource } from './readers'

const CHUNK = 64 * 1024
const encoder = new TextEncoder()
export function isLegacyResourceKey(key: string): boolean {
  return ['picture:', 'file:', 'link:', 'parseFile-', 'parseUrl-'].some((prefix) => key.startsWith(prefix))
}

function* textChunks(value: string): Generator<Uint8Array> {
  for (let offset = 0; offset < value.length; ) {
    let end = Math.min(offset + CHUNK, value.length)
    const last = value.charCodeAt(end - 1)
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--
    yield encoder.encode(value.slice(offset, end))
    offset = end
  }
}

/** Normalizes one persisted string resource while keeping byte buffers bounded. */
export function stringResource(key: string, value: unknown, maxBytes: number, signal?: AbortSignal): LegacyResource {
  if (typeof value !== 'string') throw new Error('Invalid legacy resource value')
  let size = 0
  if (!value.startsWith('data:')) {
    for (const bytes of textChunks(value)) {
      throwIfAborted(signal)
      size += bytes.length
      if (size > maxBytes) throw new Error('Resource exceeds its size budget')
    }
    return {
      path: key,
      keys: [key],
      mimeType: 'text/plain',
      contentType: 'text',
      size,
      data: (async function* () {
        yield* textChunks(value)
      })(),
    }
  }
  const comma = value.indexOf(',')
  if (comma < 0 || comma > 1024) throw new Error('Invalid legacy resource data URL')
  const header = value.slice(5, comma)
  if (!header.endsWith(';base64')) throw new Error('Unsupported resource data URL encoding')
  const start = comma + 1,
    bodyLength = value.length - start
  if (bodyLength % 4 !== 0) throw new Error('Invalid legacy resource base64 length')
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  size = (bodyLength / 4) * 3 - padding
  if (size > maxBytes) throw new Error('Resource exceeds its size budget')
  return {
    path: key,
    keys: [key],
    mimeType: header.slice(0, -7) || 'application/octet-stream',
    contentType: 'binary',
    size,
    data: (async function* () {
      for (let offset = start; offset < value.length; offset += CHUNK) {
        throwIfAborted(signal)
        const part = value.slice(offset, offset + CHUNK)
        const last = offset + CHUNK >= value.length
        if (!(last ? /^[A-Za-z0-9+/]*={0,2}$/ : /^[A-Za-z0-9+/]*$/).test(part))
          throw new Error('Invalid legacy resource base64 data')
        const binary = atob(part),
          bytes = new Uint8Array(binary.length)
        for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i)
        yield bytes
      }
    })(),
  }
}
