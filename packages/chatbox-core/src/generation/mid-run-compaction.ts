import { buildCompactionHandoff, getCompactionHandoffMode } from '@shared/context/compaction-handoff'
import type { TokenizerType } from '@shared/token-estimation/tokenizer'
import { VIEW_IMAGE_FOLLOW_UP_LABEL_PREFIX } from '@shared/tools/view-image'
import type { MessageContentParts } from '@shared/types'
import type { ModelMessage } from 'ai'
import { estimateTokensBySampling } from '../application/token-estimation/math'

/** Counts tokens in model-facing text with the request's tokenizer. */
export type CountTextTokens = (text: string) => number

const PER_MESSAGE_OVERHEAD_TOKENS = 4
/** Media parts are not counted as JSON/base64; providers tokenize them separately. */
const MEDIA_PART_TOKENS = 64

/**
 * The token estimator's constant-cost count for the request's tokenizer, so a
 * large or unbroken tool result never stalls a generation step.
 */
export function textTokenCounter(tokenizerType: TokenizerType): CountTextTokens {
  return (text) => estimateTokensBySampling(text, tokenizerType)
}

const countDefaultTokens = textTokenCounter('default')

function serialize(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function isMediaPart(part: unknown): boolean {
  if (!part || typeof part !== 'object' || !('type' in part)) return false
  return part.type === 'image' || part.type === 'file'
}

const MEDIA_OUTPUT_TYPES = new Set([
  'file',
  'image-data',
  'image-url',
  'file-data',
  'file-url',
  'audio-data',
  'video-data',
  'video-url',
])

/**
 * Collect the chargeable text of one protocol part and return its media count.
 * Only protocol media parts are exempt. JSON tool results remain chargeable text.
 */
function collectProtocolPart(part: unknown, texts: string[]): number {
  if (isMediaPart(part)) return 1
  if (!part || typeof part !== 'object' || !('type' in part)) {
    texts.push(serialize(part))
    return 0
  }
  if (part.type !== 'tool-result' || !('output' in part)) {
    texts.push(serialize(part))
    return 0
  }

  const output = part.output
  if (
    !output ||
    typeof output !== 'object' ||
    !('type' in output) ||
    output.type !== 'content' ||
    !('value' in output) ||
    !Array.isArray(output.value)
  ) {
    texts.push(serialize(part))
    return 0
  }

  // Do not stringify the outer tool-result before removing its media bytes.
  // Native Anthropic / Google / Responses results carry image files here, unlike
  // the top-level user image used by chat-completions protocols.
  const { output: _output, ...envelope } = part
  texts.push(serialize(envelope))
  let media = 0
  for (const item of output.value as unknown[]) {
    if (item && typeof item === 'object' && 'type' in item && typeof item.type === 'string') {
      if (MEDIA_OUTPUT_TYPES.has(item.type)) {
        media += 1
        continue
      }
    }
    texts.push(serialize(item))
  }
  return media
}

function countModelMessageTokens(message: ModelMessage, countText: CountTextTokens): number {
  const texts: string[] = []
  let media = 0
  const { content } = message
  if (typeof content === 'string') texts.push(content)
  else if (!Array.isArray(content)) texts.push(serialize(content))
  else for (const part of content) media += collectProtocolPart(part, texts)
  return countText(texts.join('\n')) + media * MEDIA_PART_TOKENS + PER_MESSAGE_OVERHEAD_TOKENS
}

/** Per-message counter that reuses counts for message objects already seen in earlier steps of a run. */
export function createModelMessageTokenCounter(countText: CountTextTokens): (message: ModelMessage) => number {
  const cache = new WeakMap<ModelMessage, number>()
  return (message) => {
    const cached = cache.get(message)
    if (cached !== undefined) return cached
    const tokens = countModelMessageTokens(message, countText)
    cache.set(message, tokens)
    return tokens
  }
}

export function estimateModelMessageTokens(
  message: ModelMessage,
  countText: CountTextTokens = countDefaultTokens
): number {
  return countModelMessageTokens(message, countText)
}

export function estimateModelMessagesTokens(
  messages: ModelMessage[],
  countMessage: (message: ModelMessage) => number = (message) => estimateModelMessageTokens(message)
): number {
  let total = 0
  for (const message of messages) {
    total += countMessage(message)
  }
  return total
}

function isSyntheticToolImageUserMessage(message: ModelMessage | undefined): boolean {
  if (!message || message.role !== 'user' || !Array.isArray(message.content)) return false
  let hasImage = false
  let hasLabel = false
  for (const part of message.content) {
    if (!part || typeof part !== 'object' || !('type' in part)) continue
    if (part.type === 'image' || part.type === 'file') hasImage = true
    if (
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string' &&
      part.text.startsWith(VIEW_IMAGE_FOLLOW_UP_LABEL_PREFIX)
    ) {
      hasLabel = true
    }
  }
  return hasImage && hasLabel
}

function alignKeptStartToToolRound(messages: ModelMessage[], start: number): number {
  let aligned = start
  while (aligned > 0 && isSyntheticToolImageUserMessage(messages[aligned])) {
    aligned -= 1
  }
  while (aligned > 0 && messages[aligned]?.role === 'tool') {
    aligned -= 1
  }
  return aligned
}

/**
 * First index of the retained tail. Tool results and follow-up image messages stay
 * with their assistant call: a cut never starts on a `tool` or image-follow-up user.
 */
export function findKeptModelMessageStartIndex(
  messages: ModelMessage[],
  keepRecentTokens: number,
  countMessage: (message: ModelMessage) => number = (message) => estimateModelMessageTokens(message)
): number {
  if (messages.length === 0 || keepRecentTokens <= 0) {
    return messages.length
  }

  let tokens = 0
  let start = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const next = countMessage(messages[index])
    if (tokens > 0 && tokens + next > keepRecentTokens) {
      start = index + 1
      break
    }
    tokens += next
    start = index
  }

  return alignKeptStartToToolRound(messages, start)
}

export function collectToolCallIds(messages: ModelMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part && typeof part === 'object' && 'toolCallId' in part && typeof part.toolCallId === 'string') {
        ids.add(part.toolCallId)
      }
    }
  }
  return ids
}

export function firstToolCallIdInMessages(messages: ModelMessage[]): string | undefined {
  for (const id of collectToolCallIds(messages)) return id
  return undefined
}

/** Resolve a retained tool-call identity to the current request array. */
export function resolveKeptModelMessageStartIndex(messages: ModelMessage[], keepToolCallId: string): number {
  for (let index = 0; index < messages.length; index += 1) {
    if (!collectToolCallIds([messages[index]]).has(keepToolCallId)) continue
    return alignKeptStartToToolRound(messages, index)
  }
  return -1
}

export function rewriteModelMessagesWithSummary(
  messages: ModelMessage[],
  summary: string,
  keepStartIndex: number,
  language?: string
): ModelMessage[] {
  const leadingSystem = messages.slice(0, keepStartIndex).filter((message) => message.role === 'system')
  const [next, ...rest] = messages.slice(keepStartIndex)
  const { text } = buildCompactionHandoff(summary, getCompactionHandoffMode(next?.role), language)
  if (next?.role === 'user') {
    // One user turn: the summary leads the user message that follows it.
    const merged: ModelMessage = {
      ...next,
      content:
        typeof next.content === 'string' ? `${text}\n\n${next.content}` : [{ type: 'text', text }, ...next.content],
    }
    return [...leadingSystem, merged, ...rest]
  }
  return [...leadingSystem, { role: 'user', content: text }, ...(next ? [next, ...rest] : [])]
}

/**
 * First content-part index that belongs to the retained tail of a generating
 * assistant, or -1 when the generating message has nothing to split off.
 */
export function findKeptContentPartStartIndex(parts: MessageContentParts, keptToolCallIds: Set<string>): number {
  if (keptToolCallIds.size === 0) return -1
  let start = parts.findIndex((part) => part.type === 'tool-call' && keptToolCallIds.has(part.toolCallId))
  // ModelMessage keeps the complete assistant block before a tool result. Keep
  // its preceding text/reasoning in the durable tail too (especially signed
  // thinking), so a later history resend has the same tool-round boundary.
  while (start > 0 && parts[start - 1].type !== 'tool-call') start -= 1
  return start
}
