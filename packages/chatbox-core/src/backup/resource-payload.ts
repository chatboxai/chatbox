import { BackupMessageValidator, backupPayloadBlocks } from './payload'

type Token = { kind: 'punctuation' | 'scalar' | 'string-start' | 'string-part' | 'string-end'; value: string }
export class JsonTokens {
  private decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  private validator = new BackupMessageValidator()
  private string = false
  private escape = false
  private scalar = ''
  public *write(bytes: Uint8Array): Generator<Token> {
    this.validator.write(bytes)
    const text = this.decoder.decode(bytes, { stream: true })
    let fragment = ''
    for (const c of text) {
      if (this.string) {
        if (c === '"' && !this.escape) {
          if (fragment) {
            yield { kind: 'string-part', value: fragment }
            fragment = ''
          }
          yield { kind: 'string-end', value: '"' }
          this.string = false
        } else {
          fragment += c
          this.escape = c === '\\' && !this.escape
          if (fragment.length >= 8192) {
            yield { kind: 'string-part', value: fragment }
            fragment = ''
          }
        }
      } else {
        if (this.scalar && /[\s,}\]]/.test(c)) {
          yield { kind: 'scalar', value: this.scalar }
          this.scalar = ''
        }
        if (/\s/.test(c)) continue
        if (c === '"') {
          this.string = true
          yield { kind: 'string-start', value: c }
        } else if ('{}[]:,'.includes(c)) yield { kind: 'punctuation', value: c }
        else {
          this.scalar += c
          if (this.scalar.length > 256) throw new Error('Backup scalar exceeds budget')
        }
      }
    }
    if (fragment) yield { kind: 'string-part', value: fragment }
  }
  *finish(): Generator<Token> {
    this.decoder.decode()
    if (this.scalar) yield { kind: 'scalar', value: this.scalar }
    this.validator.finish()
  }
}

const ragFields = new Set([
  'sessionAttachmentId',
  'sessionAttachmentAvailability',
  'sessionAttachmentIndexStatus',
  'sessionAttachmentBlockedReason',
  'sessionAttachmentWarningReason',
  'sessionAttachmentStatus',
  'sessionAttachmentChunkCount',
  'sessionAttachmentTotalChunks',
  'sessionAttachmentEmbeddedChunks',
  'sessionAttachmentIndexingStage',
])
type Path = Array<string | number>
type Frame = {
  path: Path
  array: boolean
  index: number
  key?: string
  expectsKey: boolean
  first: boolean
  skip: boolean
}

function referencePath(path: Path) {
  const [root, index, key, legacyKey] = path
  if (typeof index !== 'number') return false
  if (path.length === 3) {
    if (root === 'files') return key === 'storageKey' || key === 'rawStorageKey'
    if (root === 'pictures' || root === 'links') return key === 'storageKey'
    if (root === 'contentParts')
      return key === 'storageKey' || key === 'resultStorageKey' || key === 'resultImageStorageKey'
  }
  return path.length === 4 && root === 'contentParts' && key === 'result' && legacyKey === 'image_storage_key'
}

/** Changes only attachment metadata paths; free text and tool arguments stream unchanged. */
export class BackupResourcePayloadTransform {
  private tokenizer = new JsonTokens()
  private encoder = new TextEncoder()
  private outputValidator = new BackupMessageValidator()
  constructor(private readonly resourceKeys?: ReadonlyMap<string, string>) {}

  private stack: Frame[] = []
  private keyString = false
  private collected = ''
  private collect = false
  private skip = false
  private path: Path = []
  private begin() {
    const parent = this.stack.at(-1)
    this.path = parent ? [...parent.path, parent.array ? parent.index++ : parent.key!] : []
    this.skip =
      parent?.skip === true ||
      (this.path.length === 3 &&
        this.path[0] === 'files' &&
        (this.path[2] === 'localPath' || ragFields.has(String(this.path[2]))))
    if (!parent || this.skip) return ''
    const prefix = (parent.first ? '' : ',') + (parent.array ? '' : `${JSON.stringify(parent.key)}:`)
    parent.first = false
    return prefix
  }
  private *output(tokens: Iterable<Token>): Generator<string> {
    for (const token of tokens) {
      const frame = this.stack.at(-1)
      if (token.kind === 'string-start') {
        this.keyString = Boolean(frame && !frame.array && frame.expectsKey)
        if (this.keyString) {
          this.collected = '"'
          continue
        }
        const prefix = this.begin()
        if (prefix) yield prefix
        this.collect = Boolean(
          this.resourceKeys &&
            (referencePath(this.path) ||
              (this.path.length === 3 && this.path[0] === 'files' && this.path[2] === 'ragMode'))
        )
        this.collected = this.collect ? '"' : ''
        if (!this.skip && !this.collect) yield '"'
      } else if (token.kind === 'string-part' || token.kind === 'string-end') {
        if (this.keyString || this.collect) {
          this.collected += token.value
          if (this.collected.length > 196610) throw new Error('Backup resource identifier exceeds budget')
        } else if (!this.skip) yield token.value
        if (token.kind === 'string-end') {
          if (this.keyString) {
            frame!.key = JSON.parse(this.collected) as string
            frame!.expectsKey = false
          } else if (this.collect && !this.skip) {
            const value = JSON.parse(this.collected) as string
            yield JSON.stringify(
              referencePath(this.path)
                ? (this.resourceKeys!.get(value) ?? value)
                : value === 'session-retrieval'
                  ? 'inline'
                  : value
            )
          }
          this.keyString = false
          this.collect = false
        }
      } else if (token.kind === 'scalar') {
        const prefix = this.begin()
        if (!this.skip) yield prefix + token.value
      } else if (token.value === '{' || token.value === '[') {
        const prefix = this.begin()
        if (!this.skip) yield prefix + token.value
        this.stack.push({
          path: this.path,
          array: token.value === '[',
          index: 0,
          expectsKey: token.value === '{',
          first: true,
          skip: this.skip,
        })
      } else if (token.value === '}' || token.value === ']') {
        const ended = this.stack.pop()!
        if (!ended.skip) yield token.value
      } else if (token.value === ',') {
        if (frame && !frame.array) frame.expectsKey = true
      }
    }
  }
  private encode(tokens: Iterable<Token>): Uint8Array[] {
    const data = this.encoder.encode([...this.output(tokens)].join(''))
    const bytes: Uint8Array[] = []
    for (let i = 0; i < data.length; i += 128 * 1024) bytes.push(data.subarray(i, i + 128 * 1024))
    for (const value of bytes) this.outputValidator.write(value)
    return bytes
  }
  write(bytes: Uint8Array) {
    return this.encode(this.tokenizer.write(bytes))
  }
  finish() {
    const bytes = this.encode(this.tokenizer.finish())
    return { bytes, message: this.outputValidator.finish() }
  }
}
export async function* prepareBackupMessagePayload(
  source: AsyncIterable<Uint8Array>,
  resourceKeys?: ReadonlyMap<string, string>
) {
  const transform = new BackupResourcePayloadTransform(resourceKeys)
  const output = async function* () {
    for await (const bytes of source) yield* transform.write(bytes)
    yield* transform.finish().bytes
  }
  yield* backupPayloadBlocks(output())
}
