import { deriveMessageFacts } from '../session/message-facts'
import { isMessageEligibleForAutoTitle } from '../session/message-success'
import { messageHasChatboxSearchSignInError } from '@shared/session/web-search-sign-in-error'
import { getToolResultImageReference } from '@shared/tool-result-image'
import {
  type Message,
  MessageContentPartSchema,
  MessageFileSchema,
  MessageLinkSchema,
  MessageSchema,
} from '@shared/types'
import { getWorkArtifacts } from '@shared/work-artifacts'

export type JsonPath = Array<string | number>
type Container = Record<string, unknown> | unknown[]
const STRUCTURE_BYTES = 128 * 1024
// Leave room for the surrounding message row in a 128 KiB archive record.
const RESOURCE_INDEX_BYTES = 96 * 1024
const ARRAY_SCHEMAS = {
  contentParts: MessageContentPartSchema,
  files: MessageFileSchema,
  links: MessageLinkSchema,
  compactedFiles: MessageFileSchema,
  compactedLinks: MessageLinkSchema,
}
const RESOURCE_ARRAYS = new Set(['files', 'links', 'compactedFiles', 'compactedLinks', 'pictures', 'contentParts'])
const PART_KEYS = new Set(MessageContentPartSchema.options.flatMap((schema) => Object.keys(schema.shape)))
const LEGACY_KEYS = new Set(['content', 'pictures', 'webBrowsing'])
// Row encoding and presentation metadata also read these fields from legacy payloads.
const MESSAGE_KEYS = new Set([
  'id',
  'role',
  'contentParts',
  'files',
  'links',
  'compactedFiles',
  'compactedLinks',
  'timestamp',
  'updatedAt',
  'generating',
  'isSummary',
  'isForkMarker',
  'error',
  'errorCode',
  'finishReason',
  'steered',
])
const RESULT_KEYS = new Set(['image_storage_key', 'media_type', 'file_path', 'artifacts', 'errorCode'])
const ARTIFACT_KEYS = new Set(['path', 'name', 'mimeType', 'size', 'storageKey'])
const encoder = new TextEncoder()

export function isBackupResourcePath(path: JsonPath): boolean {
  const [root, index, key, nested] = path
  if (typeof index !== 'number') return false
  if (path.length === 3 && RESOURCE_ARRAYS.has(String(root)))
    return ['storageKey', 'rawStorageKey', 'resultStorageKey', 'resultImageStorageKey'].includes(String(key))
  if (root !== 'contentParts' || key !== 'result') return false
  return path.length === 4 && nested === 'image_storage_key'
}

function assign(container: Container, key: string | number, value: unknown) {
  if (Array.isArray(container)) container.push(value)
  else Object.defineProperty(container, key, { value, enumerable: true, configurable: true, writable: true })
}

/** Keeps the exact v3 projection when it fits; payload bytes remain authoritative for larger messages. */
export class FullBackupProjection {
  private stack: Container[] = []
  private root: unknown
  private bytes = 0
  private enabled = true
  private charge(bytes: number) {
    this.bytes += bytes
    if (this.bytes > STRUCTURE_BYTES) {
      this.enabled = false
      this.root = undefined
      this.stack = []
    }
  }
  key(key: string) {
    if (this.enabled) this.charge(encoder.encode(key).length + key.length * 2 + 16)
  }
  scalar(path: JsonPath, value: unknown) {
    if (!this.enabled) return
    this.charge(typeof value === 'string' ? value.length * 2 + 16 : 16)
    if (!this.enabled) return
    const parent = this.stack.at(-1)
    if (parent) assign(parent, path[path.length - 1], value)
    else this.root = value
  }
  start(path: JsonPath, array: boolean) {
    if (!this.enabled) return
    const value: Container = array ? [] : Object.create(null)
    this.scalar(path, value)
    if (this.enabled) this.stack.push(value)
  }
  end() {
    if (this.enabled) this.stack.pop()
  }
  finish() {
    return this.root
  }
}

type Frame = { path: JsonPath; value: Container; keep: boolean; budget: { bytes: number } }
function keepPath(path: JsonPath) {
  if (!path.length) return true
  const [root, , field, child, index, key] = path
  if (typeof root !== 'string' || (!Object.hasOwn(MessageSchema.shape, root) && !LEGACY_KEYS.has(root))) return false
  if (root === 'errorExtra' && path.length > 1) return false
  if (root !== 'contentParts' || path.length < 3) return true
  if (!PART_KEYS.has(String(field)) || field === 'args') return false
  if (field === 'values' && path.length > 3) return false
  if ((field === 'providerMetadata' || field === 'resultProviderMetadata') && path.length > 4) return false
  if (field !== 'result' || path.length === 3) return true
  if (!RESULT_KEYS.has(String(child))) return false
  if (child !== 'artifacts') return path.length === 4
  if (path.length === 4) return true
  return (
    typeof index === 'number' &&
    index < 20 &&
    (path.length === 5 || (path.length === 6 && ARTIFACT_KEYS.has(String(key))))
  )
}

/** Validates each content part independently and retains only message identity and resource discovery data. */
export class CompactBackupProjection {
  private stack: Frame[] = []
  private root: unknown
  private retainedBytes = 0
  private schemaError: unknown
  private promptCacheChars = 0
  private hasToolCall = false
  private hasLegacyCommand = false
  private meaningfulOutput = false
  private nonReplyPart = false
  private partCount = 0
  private textLength = 0
  private partText?: { length: number; nonWhitespace: boolean }

  text(path: JsonPath, length: number, nonWhitespace: boolean) {
    if (path.length === 3 && path[0] === 'contentParts' && path[2] === 'text') this.partText = { length, nonWhitespace }
  }

  facts(message: Message) {
    const facts = deriveMessageFacts(message)
    const namingMessage: Message = {
      ...message,
      contentParts: this.meaningfulOutput
        ? [{ type: 'text', text: 'x' }]
        : this.textLength > 0 || this.partCount > 1
          ? [{ type: 'text', text: ' ' }]
          : [],
    }
    return {
      ...facts,
      promptCacheChars: this.promptCacheChars,
      hasToolCall: this.hasToolCall,
      hasLegacyCommand: this.hasLegacyCommand,
      autoTitleEligible:
        (message.role !== 'assistant' || !this.nonReplyPart) && isMessageEligibleForAutoTitle(namingMessage),
    }
  }

  private check(run: () => void) {
    try {
      run()
    } catch (error) {
      this.schemaError ??= error
    }
  }
  private budget(path: JsonPath) {
    return path.length <= 1 || (path.length === 2 && Object.hasOwn(ARRAY_SCHEMAS, path[0]))
      ? { bytes: 0 }
      : (this.stack.at(-1)?.budget ?? { bytes: 0 })
  }
  private charge(budget: { bytes: number }, key: string | number | undefined, value: unknown) {
    budget.bytes +=
      (typeof key === 'string' ? key.length * 2 + 16 : 0) + (typeof value === 'string' ? value.length * 2 + 16 : 16)
    if (budget.bytes > STRUCTURE_BYTES) throw new Error('Backup message field exceeds budget')
  }
  start(path: JsonPath, array: boolean) {
    const keep = (this.stack.at(-1)?.keep ?? true) && keepPath(path)
    this.stack.push({ path, value: array ? [] : Object.create(null), keep, budget: this.budget(path) })
  }
  scalar(path: JsonPath, value: unknown) {
    if (!(this.stack.at(-1)?.keep ?? true) || !keepPath(path)) return
    this.accept(path, value, this.budget(path))
  }
  end() {
    const frame = this.stack[this.stack.length - 1]
    this.stack.pop()
    if (frame.keep) this.accept(frame.path, frame.value, frame.budget)
  }
  private retain(value: unknown) {
    this.retainedBytes += encoder.encode(JSON.stringify(value)).length
    if (this.retainedBytes > RESOURCE_INDEX_BYTES) throw new Error('Backup message resource index exceeds budget')
  }
  private accept(path: JsonPath, value: unknown, budget: { bytes: number }) {
    this.charge(budget, path.at(-1), value)
    const parent = this.stack.at(-1)
    if (!parent) {
      this.root = value
      return
    }
    if (path.length === 2 && Object.hasOwn(ARRAY_SCHEMAS, path[0])) {
      const key = path[0] as keyof typeof ARRAY_SCHEMAS
      this.check(() => ARRAY_SCHEMAS[key].parse(value))
      if (key === 'contentParts') {
        const result = MessageContentPartSchema.safeParse(value)
        if (!result.success) return
        const part = result.data
        this.partCount++
        if (part.type === 'text' || part.type === 'reasoning') {
          const length = this.partText?.length ?? part.text.length
          this.textLength += length
          this.promptCacheChars = Math.min(4000, this.promptCacheChars + length)
          this.meaningfulOutput ||= this.partText?.nonWhitespace ?? Boolean(part.text.trim())
        } else if (part.type === 'image') {
          this.promptCacheChars = Math.min(4000, this.promptCacheChars + 7)
          this.meaningfulOutput = true
        } else if (part.type === 'tool-call') {
          this.hasToolCall = true
          this.hasLegacyCommand ||= part.toolName === 'user_exec' || part.toolName === 'code_execution'
          this.meaningfulOutput ||= part.state === 'result' && part.result !== undefined
          this.nonReplyPart ||= part.state === 'paused'
        } else if (part.type === 'agent-mode-suggestion') this.nonReplyPart = true
        this.partText = undefined
        if (
          part.type === 'tool-call' &&
          (part.resultStorageKey ||
            getToolResultImageReference(part) ||
            getWorkArtifacts(part).length ||
            part.state === 'paused' ||
            messageHasChatboxSearchSignInError({ id: '', role: 'assistant', contentParts: [part] }))
        ) {
          value = {
            type: part.type,
            state: part.state,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            ...(part.resultStorageKey === undefined ? {} : { resultStorageKey: part.resultStorageKey }),
            ...(part.resultImageStorageKey === undefined ? {} : { resultImageStorageKey: part.resultImageStorageKey }),
            ...(part.resultImageMediaType === undefined ? {} : { resultImageMediaType: part.resultImageMediaType }),
            ...(part.result === undefined ? {} : { result: part.result }),
            ...(part.pauseReason === undefined ? {} : { pauseReason: part.pauseReason }),
          }
        } else if (part.type === 'image') value = { type: 'image', storageKey: part.storageKey }
        else if (part.type === 'reasoning') {
          if ((parent.value as unknown[]).length) return
          value = { type: 'reasoning', text: '' }
        } else {
          // Legacy migration distinguishes empty text, a placeholder, and visible content.
          const text = part.type === 'text' ? part.text : ''
          const parts = parent.value as Message['contentParts']
          const previous = parts.find((item) => item.type === 'text')
          if (previous?.type === 'text') {
            previous.text = `${previous.text}\n${text.slice(0, 16)}`.slice(0, 16)
            return
          }
          value = { type: 'text', text: text.slice(0, 16) }
        }
      }
      this.retain(value)
    } else if (path.length === 1) {
      const key = String(path[0])
      if (Object.hasOwn(MessageSchema.shape, key))
        this.check(() => MessageSchema.shape[key as keyof typeof MessageSchema.shape].parse(value))
      if (!MESSAGE_KEYS.has(key) && !LEGACY_KEYS.has(key)) return
      if (!Object.hasOwn(ARRAY_SCHEMAS, key)) this.retain(value)
    }
    assign(parent.value, path[path.length - 1], value)
  }
  finish() {
    if (this.schemaError) throw this.schemaError
    return this.root
  }
}
