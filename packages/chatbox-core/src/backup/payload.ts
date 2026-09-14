import { MessageSchema, type Message } from '@shared/types'

export const BACKUP_PAYLOAD_BLOCK_BYTES = 128 * 1024
type Frame = {
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
    if (this.text.length < 4096) this.text += value
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
        this.accept(value)
        this.stack.push({ value, state: c === '[' ? 'value-or-end' : 'key-or-end' })
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
  finish(): Message {
    this.consume(this.decoder.decode())
    if (this.token && this.token !== 'string') this.endScalar()
    if (this.token || this.stack.length || !this.complete) throw new Error('Incomplete backup message JSON')
    return MessageSchema.passthrough().parse(this.root)
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
