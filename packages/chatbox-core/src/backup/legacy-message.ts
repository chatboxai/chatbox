import { migrateMessage } from '@shared/utils/message'
import type { Message } from '@shared/types'
import { throwIfAborted } from './abort'
import { jsonUtf8Blocks } from './json-stream'
import { readBackupFileBytes, type BackupFile } from './types'

const encoder = new TextEncoder()
interface Field {
  key: string
  start: number
  end: number
}
async function* readRange(file: BackupFile, start: number, end: number, signal?: AbortSignal) {
  for (let offset = start; offset < end; offset += 64 * 1024) {
    throwIfAborted(signal)
    yield await readBackupFileBytes(file, offset, Math.min(64 * 1024, end - offset))
  }
}
/** Copies historical fields and forms current content parts while keeping large content in the source. */
export async function* legacyMessageChunks(
  file: BackupFile,
  start: number,
  end: number,
  projection: Message,
  signal?: AbortSignal
): AsyncGenerator<Uint8Array> {
  const fields: Field[] = []
  let depth = 0
  let quoted = false
  let escaped = false
  let readingKey = false
  let keyBytes: number[] = []
  let key = ''
  let expectKey = false
  let valueStart = -1
  let expectValue = false
  let offset = start
  for await (const bytes of readRange(file, start, end, signal)) {
    for (let index = 0; index < bytes.length; index++) {
      const c = bytes[index]
      const position = offset + index
      if (quoted) {
        if (readingKey) {
          keyBytes.push(c)
          if (keyBytes.length > 8192) throw new Error('Legacy message key exceeds budget')
        }
        if (escaped) escaped = false
        else if (c === 92) escaped = true
        else if (c === 34) {
          quoted = false
          if (readingKey) {
            key = JSON.parse(new TextDecoder().decode(Uint8Array.from(keyBytes)))
            readingKey = false
            expectKey = false
          }
        }
        continue
      }
      if (expectValue && ![9, 10, 13, 32].includes(c)) {
        valueStart = position
        expectValue = false
      }
      if (c === 34) {
        quoted = true
        readingKey = depth === 1 && expectKey
        if (readingKey) keyBytes = [34]
      } else if (c === 123 || c === 91) {
        depth++
        if (depth === 1) expectKey = true
      } else if ((c === 44 || c === 125) && depth === 1) {
        if (valueStart >= 0) {
          if (fields.length >= 4096) throw new Error('Legacy message fields exceed budget')
          fields.push({ key, start: valueStart, end: position })
          valueStart = -1
        }
        if (c === 44) expectKey = true
        else depth--
      } else if (c === 125 || c === 93) depth--
      else if (c === 58 && depth === 1) expectValue = true
    }
    offset += bytes.length
  }
  const metadata: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.key !== 'webBrowsing' && field.key !== 'pictures') continue
    if (field.end - field.start > 128 * 1024)
      throw new Error('Legacy image/search metadata exceeds the inline backup budget')
    const data = new Uint8Array(field.end - field.start)
    let offset = 0
    for await (const bytes of readRange(file, field.start, field.end, signal)) {
      data.set(bytes, offset)
      offset += bytes.length
    }
    metadata[field.key] = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
  }
  const originalParts = projection.contentParts
  const partsInput = [...originalParts]
  const migrated = migrateMessage({ ...projection, ...metadata, contentParts: partsInput })
  const content = fields.findLast((field) => field.key === 'content')
  const legacyContent = (projection as Message & { content?: unknown }).content
  yield encoder.encode('{')
  for (const field of fields) {
    if (field.key === 'contentParts' || field.key === 'webBrowsing') continue
    yield encoder.encode(`${JSON.stringify(field.key)}:`)
    yield* readRange(file, field.start, field.end, signal)
    yield encoder.encode(',')
  }
  yield encoder.encode('"contentParts":[')
  const partsField = fields.findLast((field) => field.key === 'contentParts')
  if (migrated.contentParts === partsInput && partsField) {
    if ('webBrowsing' in projection) {
      yield* jsonUtf8Blocks(migrated.contentParts[0])
      if (originalParts.length) yield encoder.encode(',')
    }
    let arrayEnd = partsField.end
    for (;;) {
      const tail = await readBackupFileBytes(
        file,
        Math.max(partsField.start, arrayEnd - 65536),
        Math.min(65536, arrayEnd - partsField.start)
      )
      let index = tail.length - 1
      while (index >= 0 && [9, 10, 13, 32].includes(tail[index])) {
        arrayEnd--
        index--
      }
      if (index >= 0) {
        if (tail[index] !== 93) throw new Error('Invalid legacy content parts')
        break
      }
      if (arrayEnd <= partsField.start) throw new Error('Invalid legacy content parts')
    }
    yield* readRange(file, partsField.start + 1, arrayEnd - 1, signal)
  } else
    for (const [index, part] of migrated.contentParts.entries()) {
      if (index) yield encoder.encode(',')
      if (part.type === 'text' && typeof legacyContent === 'string' && part.text === legacyContent && content) {
        yield encoder.encode('{"type":"text","text":')
        yield* readRange(file, content.start, content.end, signal)
        yield encoder.encode('}')
      } else yield* jsonUtf8Blocks(part)
    }
  yield encoder.encode(']}')
}
