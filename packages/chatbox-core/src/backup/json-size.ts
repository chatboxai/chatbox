import { JsonTokens } from './resource-payload'

/** Counts canonical JSON.stringify UTF-8 bytes without retaining string bodies. */
export class BackupJsonSize {
  /** Callers feed transform output, which the transform has already validated. */
  private tokens = new JsonTokens(false)
  private encoder = new TextEncoder()
  private size = 0
  private raw = ''
  private surrogate = ''
  private consume(tokens: ReturnType<JsonTokens['write']>) {
    for (const token of tokens) {
      if (token.kind === 'string-part' || token.kind === 'string-end') {
        this.raw += token.kind === 'string-part' ? token.value : ''
        let end = 0
        for (let index = 0; index < this.raw.length; ) {
          const length = this.raw[index] === '\\' ? (this.raw[index + 1] === 'u' ? 6 : 2) : 1
          if (index + length > this.raw.length) break
          index += length
          end = index
        }
        if (end) {
          let text: string = this.surrogate + JSON.parse(`"${this.raw.slice(0, end)}"`)
          this.raw = this.raw.slice(end)
          this.surrogate = ''
          const last = text.charCodeAt(text.length - 1)
          if (last >= 0xd800 && last <= 0xdbff) {
            this.surrogate = text.slice(-1)
            text = text.slice(0, -1)
          }
          this.size += this.encoder.encode(JSON.stringify(text).slice(1, -1)).length
        }
        if (token.kind === 'string-end') {
          if (this.raw) throw new Error('Incomplete backup JSON escape')
          this.size += this.encoder.encode(JSON.stringify(this.surrogate).slice(1, -1)).length + 1
          this.surrogate = ''
        }
      } else if (token.kind === 'scalar') this.size += JSON.stringify(JSON.parse(token.value)).length
      else this.size += token.value.length
    }
  }
  /** Completed canonical bytes form a monotonic lower bound until finish. */
  get bytes() {
    return this.size
  }
  write(bytes: Uint8Array) {
    this.consume(this.tokens.write(bytes))
  }
  finish() {
    this.consume(this.tokens.finish())
    return this.size
  }
}
