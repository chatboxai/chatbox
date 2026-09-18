import { type Message, MessageSchema } from '@shared/types'

export const BACKUP_PAYLOAD_BLOCK_BYTES = 128 * 1024
/** Payloads up to this size are parsed natively instead of being scanned by the streaming passes. */
export const NATIVE_PAYLOAD_LIMIT_BYTES = 8 * 1024 * 1024

/** Reads a payload of known size into memory and parses it once; the returned message keeps unknown fields. */
export async function materializeBackupPayload(
  chunks: AsyncIterable<Uint8Array>,
  size: number
): Promise<{ bytes: Uint8Array; message: Message }> {
  const bytes = new Uint8Array(size)
  let offset = 0
  for await (const part of chunks) {
    if (offset + part.length > size) throw new Error('Backup payload size mismatch')
    bytes.set(part, offset)
    offset += part.length
  }
  if (offset !== size) throw new Error('Backup payload size mismatch')
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  MessageSchema.parse(value)
  return { bytes, message: value as Message }
}

/** Serializes a message into payload blocks and the projection importers recompute from those bytes. */
export function serializeBackupPayload(message: Message): { blocks: Uint8Array[]; projection: Message } {
  const bytes = new TextEncoder().encode(JSON.stringify(message))
  const validator = new BackupMessageValidator()
  const blocks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.length; offset += BACKUP_PAYLOAD_BLOCK_BYTES) {
    const block = bytes.subarray(offset, offset + BACKUP_PAYLOAD_BLOCK_BYTES)
    validator.write(block)
    blocks.push(block)
  }
  return { blocks, projection: validator.finish() }
}

const RESOURCE_ROOTS = new Set(['files', 'links', 'pictures', 'contentParts'])
const RESOURCE_KEYS = new Set(['storageKey', 'rawStorageKey', 'resultStorageKey', 'resultImageStorageKey'])
function projectValue(value: unknown, path: Array<string | number>, key: string | undefined): unknown {
  if (typeof value === 'string') {
    // path names the string itself; the validator's limits are keyed on its container path.
    const container = path.slice(0, -1)
    const resource =
      typeof container[1] === 'number' &&
      ((container.length === 2 && RESOURCE_ROOTS.has(String(container[0])) && RESOURCE_KEYS.has(key ?? '')) ||
        (container.length === 3 &&
          container[0] === 'contentParts' &&
          container[2] === 'result' &&
          key === 'image_storage_key'))
    return value.slice(0, resource ? 32768 : 4096)
  }
  if (Array.isArray(value)) return value.map((item, index) => projectValue(item, [...path, index], undefined))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, item] of Object.entries(value)) out[k] = projectValue(item, [...path, k], k)
    return out
  }
  return value
}
/** Bounded projection of a materialized message: the same string truncation the streaming validator applies. */
export function projectBackupMessage(message: Message): Message {
  return projectValue(message, [], undefined) as Message
}

export function* payloadBlocksOf(bytes: Uint8Array): Generator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += BACKUP_PAYLOAD_BLOCK_BYTES)
    yield bytes.subarray(offset, offset + BACKUP_PAYLOAD_BLOCK_BYTES)
}
type Frame = {
  path: Array<string | number>
  value: Record<string, unknown> | unknown[]
  state: 'key-or-end' | 'key' | 'colon' | 'value' | 'value-or-end' | 'comma-or-end'
  key?: string
}

/** Validates JSON incrementally. The projection retains structure and short scalar
 * prefixes for schema/resource validation; persisted bytes always use the original stream. */
export class BackupMessageValidator {
  private decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  private stack: Frame[] = []
  private root: unknown
  private complete = false
  private token: 'string' | 'number' | 'literal' | undefined
  private text = ''
  private stringLength = 0
  private escaped = false
  private unicode: string | undefined
  private budget = 0
  private key = false

  private retain(value: string) {
    this.stringLength += value.length
    if (this.key && this.stringLength > 1024) throw new Error('Backup JSON key exceeds budget')
    const frame = this.stack.at(-1)
    const path = frame?.path ?? []
    const resource =
      !this.key &&
      typeof path[1] === 'number' &&
      ((path.length === 2 &&
        ['files', 'links', 'pictures', 'contentParts'].includes(String(path[0])) &&
        ['storageKey', 'rawStorageKey', 'resultStorageKey', 'resultImageStorageKey'].includes(frame?.key ?? '')) ||
        (path.length === 3 && path[0] === 'contentParts' && path[2] === 'result' && frame?.key === 'image_storage_key'))
    const limit = resource ? 32768 : 4096
    if (resource && this.stringLength > limit) throw new Error('Backup resource identifier exceeds budget')
    if (this.text.length < limit) this.text += value
  }
  private accept(value: unknown) {
    this.budget += typeof value === 'string' ? value.length * 2 + 16 : 16
    if (this.budget > 128 * 1024) throw new Error('Backup message structure exceeds budget')
    const frame = this.stack.at(-1)
    if (!frame) {
      if (this.complete) throw new Error('Extra backup JSON value')
      this.root = value
      this.complete = true
    } else {
      if (frame.state !== 'value' && frame.state !== 'value-or-end') throw new Error('Invalid backup JSON value')
      if (Array.isArray(frame.value)) frame.value.push(value)
      else {
        if (frame.key === undefined) throw new Error('Missing backup JSON key')
        if (Object.hasOwn(frame.value, frame.key)) throw new Error('Duplicate backup JSON key')
        Object.defineProperty(frame.value, frame.key, { value, enumerable: true, configurable: true, writable: true })
      }
      frame.state = 'comma-or-end'
    }
  }
  private endScalar() {
    let value: unknown
    if (this.token === 'number') {
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(this.text))
        throw new Error('Invalid backup JSON number')
      value = JSON.parse(this.text)
    } else if (this.text === 'true') value = true
    else if (this.text === 'false') value = false
    else if (this.text === 'null') value = null
    else throw new Error('Invalid backup JSON literal')
    this.token = undefined
    this.text = ''
    this.accept(value)
  }
  private consume(input: string) {
    for (let i = 0; i < input.length; i++) {
      const c = input[i]
      if (this.token === 'string') {
        if (this.unicode !== undefined) {
          if (!/[\da-fA-F]/.test(c)) throw new Error('Invalid backup JSON escape')
          this.unicode += c
          if (this.unicode.length === 4) {
            this.retain(String.fromCharCode(Number.parseInt(this.unicode, 16)))
            this.unicode = undefined
          }
        } else if (this.escaped) {
          this.escaped = false
          if (c === 'u') this.unicode = ''
          else {
            const escapes: Record<string, string> = {
              '"': '"',
              '\\': '\\',
              '/': '/',
              b: '\b',
              f: '\f',
              n: '\n',
              r: '\r',
              t: '\t',
            }
            if (!Object.hasOwn(escapes, c)) throw new Error('Invalid backup JSON escape')
            this.retain(escapes[c])
          }
        } else if (c === '\\') this.escaped = true
        else if (c === '"') {
          this.token = undefined
          if (this.key) {
            this.budget += new TextEncoder().encode(this.text).length + this.text.length * 2 + 16
            if (this.budget > 128 * 1024) throw new Error('Backup message structure exceeds budget')
            const frame = this.stack.at(-1)!
            if (Object.hasOwn(frame.value, this.text)) throw new Error('Duplicate backup JSON key')
            frame.key = this.text
            frame.state = 'colon'
          } else this.accept(this.text)
          this.text = ''
        } else {
          if (c.charCodeAt(0) < 32) throw new Error('Invalid backup JSON string')
          this.retain(c)
        }
        continue
      }
      if (this.token) {
        if (/[,}\]\s]/.test(c)) {
          this.endScalar()
          i--
          continue
        }
        this.text += c
        if (this.text.length > 256) throw new Error('Backup JSON scalar exceeds budget')
        continue
      }
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') continue
      const frame = this.stack.at(-1)
      if (frame?.state === 'colon') {
        if (c !== ':') throw new Error('Invalid backup JSON colon')
        frame.state = 'value'
        continue
      }
      if (frame && (c === '}' || c === ']')) {
        const array = Array.isArray(frame.value)
        if ((array ? c !== ']' : c !== '}') || !['key-or-end', 'value-or-end', 'comma-or-end'].includes(frame.state))
          throw new Error('Invalid backup JSON end')
        this.stack.pop()
        continue
      }
      if (frame?.state === 'comma-or-end') {
        if (c !== ',') throw new Error('Invalid backup JSON comma')
        frame.state = Array.isArray(frame.value) ? 'value' : 'key'
        continue
      }
      this.key = frame?.state === 'key' || frame?.state === 'key-or-end'
      if (this.key && c !== '"') throw new Error('Invalid backup JSON key')
      if (c === '"') {
        this.token = 'string'
        this.text = ''
        this.stringLength = 0
        continue
      }
      if (c === '{' || c === '[') {
        const value = c === '[' ? [] : (Object.create(null) as Record<string, unknown>)
        const path = frame ? [...frame.path, Array.isArray(frame.value) ? frame.value.length : frame.key!] : []
        this.accept(value)
        this.stack.push({ value, path, state: c === '[' ? 'value-or-end' : 'key-or-end' })
        if (this.stack.length > 128) throw new Error('Backup JSON nesting exceeds budget')
        continue
      }
      this.token = /[-\d]/.test(c) ? 'number' : 'literal'
      this.text = c
    }
  }
  write(bytes: Uint8Array) {
    this.consume(this.decoder.decode(bytes, { stream: true }))
  }
  private finishValue(): unknown {
    this.consume(this.decoder.decode())
    if (this.token && this.token !== 'string') this.endScalar()
    if (this.token || this.stack.length || !this.complete) throw new Error('Incomplete backup message JSON')
    return this.root
  }
  finish(): Message {
    const value = this.finishValue()
    MessageSchema.parse(value)
    return value as Message
  }
  finishLegacy(): { message: Message; addContentParts: boolean } {
    const value = this.finishValue()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid legacy message')
    const addContentParts = !Object.hasOwn(value, 'contentParts')
    const message = addContentParts ? { ...value, contentParts: [] } : value
    MessageSchema.parse(message)
    return { message: message as Message, addContentParts }
  }
}

/** Coalesces bounded source slices without retaining the whole payload. */
export async function* backupPayloadBlocks(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let block = new Uint8Array(BACKUP_PAYLOAD_BLOCK_BYTES)
  let used = 0
  for await (const part of source) {
    if (part.length > BACKUP_PAYLOAD_BLOCK_BYTES) throw new Error('Backup source block exceeds budget')
    for (let offset = 0; offset < part.length; ) {
      const size = Math.min(block.length - used, part.length - offset)
      block.set(part.subarray(offset, offset + size), used)
      used += size
      offset += size
      if (used === block.length) {
        yield block
        block = new Uint8Array(BACKUP_PAYLOAD_BLOCK_BYTES)
        used = 0
      }
    }
  }
  if (used) yield block.subarray(0, used)
}
