import { readFileBytes, type ByteSource } from '../io'
import { throwIfAborted } from '../utils/abort'
import { createTaskYielder } from '../utils/task-yield'
import { defaultBackupCodec } from '../backup-v3/codec'
import type { BackupCodec } from '../backup-v3/types'

export interface JsonRange {
  start: number
  end: number
}
export interface JsonMember extends JsonRange {
  key: string
}
const whitespace = (byte: number) => byte === 32 || byte === 9 || byte === 10 || byte === 13

/** Indexes external JSON values without retaining their bodies. Arrays use numeric keys. */
export async function* jsonMembers(
  source: ByteSource,
  kind: 'object' | 'array',
  range: JsonRange = { start: 0, end: source.size },
  signal?: AbortSignal,
  codec: BackupCodec = defaultBackupCodec
): AsyncGenerator<JsonMember> {
  let state: 'start' | 'key' | 'colon' | 'value' | 'after' | 'done' = 'start'
  let key = '',
    keyBytes: number[] = [],
    keyOpen = false,
    keyEscape = false
  let valueStart = -1,
    valueKind = 0,
    quoted = false,
    escape = false
  const stack: number[] = []
  let index = 0,
    afterComma = false
  const close = kind === 'object' ? 125 : 93
  const prefix = range.start === 0 ? await readFileBytes(source, 0, Math.min(3, source.size)) : new Uint8Array()
  const bom = prefix[0] === 239 && prefix[1] === 187 && prefix[2] === 191
  const yieldTask = createTaskYielder()
  for (let offset = range.start; offset < range.end; offset += 65536) {
    throwIfAborted(signal)
    const chunk = await readFileBytes(source, offset, Math.min(65536, range.end - offset))
    for (let local = 0; local < chunk.length; local++) {
      const byte = chunk[local],
        position = offset + local
      if (bom && position < 3) continue
      if (state === 'done') {
        if (!whitespace(byte)) throw new Error('Unexpected data after legacy JSON')
        continue
      }
      if (state === 'start') {
        if (whitespace(byte)) continue
        if (byte !== (kind === 'object' ? 123 : 91)) throw new Error(`Expected legacy JSON ${kind}`)
        state = kind === 'object' ? 'key' : 'value'
        continue
      }
      if (state === 'key') {
        if (!keyOpen) {
          if (whitespace(byte)) continue
          if (byte === close && !afterComma) {
            state = 'done'
            continue
          }
          if (byte !== 34) throw new Error('Invalid legacy JSON object key')
          keyBytes = [byte]
          keyOpen = true
          continue
        }
        keyBytes.push(byte)
        if (keyBytes.length > 32768) throw new Error('Legacy JSON key exceeds its size budget')
        if (keyEscape) keyEscape = false
        else if (byte === 92) keyEscape = true
        else if (byte === 34) {
          key = JSON.parse(codec.decodeUtf8(new Uint8Array(keyBytes))) as string
          keyOpen = false
          state = 'colon'
        }
        continue
      }
      if (state === 'colon') {
        if (whitespace(byte)) continue
        if (byte !== 58) throw new Error('Legacy JSON key has no value')
        state = 'value'
        continue
      }
      if (state === 'after') {
        if (whitespace(byte)) continue
        if (byte === close) {
          state = 'done'
          continue
        }
        if (byte !== 44) throw new Error('Invalid legacy JSON separator')
        afterComma = true
        state = kind === 'object' ? 'key' : 'value'
        continue
      }
      if (valueStart < 0) {
        if (whitespace(byte)) continue
        if (kind === 'array' && byte === close && !afterComma) {
          state = 'done'
          continue
        }
        if (byte === 44 || byte === close) throw new Error('Legacy JSON value is missing')
        valueStart = position
        afterComma = false
        if (kind === 'array') key = String(index++)
        valueKind = byte === 34 ? 1 : byte === 123 || byte === 91 ? 2 : 3
        quoted = byte === 34
        escape = false
        if (valueKind === 2) stack.push(byte === 123 ? 125 : 93)
        continue
      }
      let end = -1,
        delimiter = false
      if (quoted) {
        if (escape) escape = false
        else if (byte === 92) escape = true
        else if (byte === 34) {
          quoted = false
          if (valueKind === 1) end = position + 1
        } else if (byte < 32) throw new Error('Invalid control character in legacy JSON')
      } else if (valueKind === 2) {
        if (byte === 34) quoted = true
        else if (byte === 123 || byte === 91) {
          stack.push(byte === 123 ? 125 : 93)
          if (stack.length > 256) throw new Error('Legacy JSON nesting exceeds its size budget')
        } else if (byte === 125 || byte === 93) {
          if (stack.pop() !== byte) throw new Error('Invalid legacy JSON nesting')
          if (!stack.length) end = position + 1
        }
      } else if (whitespace(byte) || byte === 44 || byte === close) {
        end = position
        delimiter = true
      }
      if (end >= 0) {
        yield { key, start: valueStart, end }
        valueStart = -1
        state = 'after'
        if (delimiter) local--
      }
    }
    await yieldTask()
  }
  if (state !== 'done') throw new Error('Legacy JSON ended unexpectedly')
}

export async function readJsonRange(
  source: ByteSource,
  range: JsonRange,
  maxBytes: number,
  codec: BackupCodec = defaultBackupCodec,
  signal?: AbortSignal
): Promise<unknown> {
  const size = range.end - range.start
  if (size > maxBytes) throw new Error('Legacy JSON value exceeds its size budget')
  const bytes = new Uint8Array(size)
  for (let offset = 0; offset < size; offset += 65536) {
    throwIfAborted(signal)
    bytes.set(await readFileBytes(source, range.start + offset, Math.min(65536, size - offset)), offset)
  }
  throwIfAborted(signal)
  return JSON.parse(codec.decodeUtf8(bytes))
}
