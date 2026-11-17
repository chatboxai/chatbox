import type { ByteSource } from '../io'
import { readFileBytes } from '../io'
import { throwIfAborted } from '../utils/abort'
import { createTaskYielder } from '../utils/task-yield'
import { defaultBackupCodec } from './codec'
import type { BackupCodec } from './types'

export const utf8 = new TextEncoder()
export function encodeJson(value: unknown): Uint8Array {
  return utf8.encode(JSON.stringify(value))
}
export function encodeLine(value: unknown): Uint8Array {
  return utf8.encode(`${JSON.stringify(value)}\n`)
}
export function decodeJson(bytes: Uint8Array, codec: BackupCodec = defaultBackupCodec): unknown {
  return JSON.parse(codec.decodeUtf8(bytes))
}
export async function* sourceChunks(source: ByteSource, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  if (source.chunks) {
    let size = 0
    for await (const chunk of source.chunks()) {
      for (let offset = 0; offset < chunk.length; offset += 64 * 1024) {
        throwIfAborted(signal)
        const bytes = chunk.subarray(offset, offset + 64 * 1024)
        size += bytes.length
        if (size > source.size) throw new Error('Resource stream exceeds its declared size')
        yield bytes
      }
    }
    if (size !== source.size) throw new Error('Resource stream ended unexpectedly')
    return
  }
  for (let offset = 0; offset < source.size; offset += 64 * 1024) {
    throwIfAborted(signal)
    yield await readFileBytes(source, offset, Math.min(64 * 1024, source.size - offset))
  }
}
export async function* singleChunk(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes
}
/** Count streamed bytes and enforce runtime budgets without retaining the entry. */
export async function* countChunks(
  chunks: AsyncIterable<Uint8Array>,
  path: string,
  maxBytes: number,
  completed: (size: number) => void,
  signal?: AbortSignal,
  processed?: (bytes: number) => void
): AsyncGenerator<Uint8Array> {
  let size = 0
  const yieldTask = createTaskYielder()
  throwIfAborted(signal)
  for await (const chunk of chunks) {
    throwIfAborted(signal)
    size += chunk.length
    if (size > maxBytes) throw new Error(`Backup entry exceeds its byte budget: ${path}`)
    processed?.(size)
    yield chunk
    await yieldTask()
  }
  throwIfAborted(signal)
  completed(size)
}

/** Buffer only one complete JSON record, including records split across arbitrary UTF-8 chunks. */
export async function* decodeJsonLines(
  chunks: AsyncIterable<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal,
  codec: BackupCodec = defaultBackupCodec
): AsyncGenerator<{ value: unknown; bytes: number }> {
  let parts: Uint8Array[] = []
  let size = 0
  for await (const chunk of chunks) {
    throwIfAborted(signal)
    let start = 0
    for (let index = 0; index < chunk.length; index++) {
      if (chunk[index] !== 10) continue
      const part = chunk.subarray(start, index)
      const length = size + part.length
      if (length === 0) throw new Error('Blank JSONL records are not allowed')
      if (length + 1 > maxBytes) throw new Error('Backup record exceeds its byte budget')
      let line = part
      if (parts.length) {
        line = new Uint8Array(length)
        let offset = 0
        for (const pending of parts) {
          line.set(pending, offset)
          offset += pending.length
        }
        line.set(part, offset)
      }
      if (line[0] === 0xef && line[1] === 0xbb && line[2] === 0xbf)
        throw new Error('JSONL byte-order markers are not allowed')
      yield { value: decodeJson(line, codec), bytes: length + 1 }
      parts = []
      size = 0
      start = index + 1
    }
    if (start < chunk.length) {
      const tail = chunk.subarray(start)
      size += tail.length
      if (size + 1 > maxBytes) throw new Error('Backup record exceeds its byte budget')
      parts.push(tail)
    }
  }
  if (size !== 0) throw new Error('JSONL must end with LF')
}
