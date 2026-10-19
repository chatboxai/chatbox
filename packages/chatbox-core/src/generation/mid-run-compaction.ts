import { buildCompactionHandoff, getCompactionHandoffMode } from '@shared/context/compaction-handoff'
import { VIEW_IMAGE_FOLLOW_UP_LABEL_PREFIX } from '@shared/tools/view-image'
import type { MessageContentParts } from '@shared/types'
import type { ModelMessage } from 'ai'

/** Fraction of the compaction threshold kept verbatim at the tail of a mid-run compact. */
export const MID_RUN_COMPACTION_RETAIN_RATIO = 0.35

const CHARS_PER_TOKEN = 4
const PER_MESSAGE_OVERHEAD_TOKENS = 4
/** Media parts are not counted as JSON/base64; providers tokenize them separately. */
const MEDIA_PART_OVERHEAD_CHARS = 256

export function retainTokensForThreshold(thresholdTokens: number): number {
  return Math.max(1, Math.floor(thresholdTokens * MID_RUN_COMPACTION_RETAIN_RATIO))
}

function estimateSerializedChars(value: unknown): number {
  if (typeof value === 'string') return value.length
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

function isMediaPart(part: unknown): boolean {
  if (!part || typeof part !== 'object' || !('type' in part)) return false
  return part.type === 'image' || part.type === 'file'
}

/** Only protocol media parts are exempt. JSON tool results remain chargeable text. */
function estimateProtocolPartChars(part: unknown): number {
  if (isMediaPart(part)) return MEDIA_PART_OVERHEAD_CHARS
  if (!part || typeof part !== 'object' || !('type' in part)) return estimateSerializedChars(part)
  if (part.type !== 'tool-result' || !('output' in part)) return estimateSerializedChars(part)

  const output = part.output
  if (
    !output ||
    typeof output !== 'object' ||
    !('type' in output) ||
    output.type !== 'content' ||
    !('value' in output) ||
    !Array.isArray(output.value)
  ) {
    return estimateSerializedChars(part)
  }

  // Do not stringify the outer tool-result before removing its media bytes.
  // Native Anthropic / Google / Responses results carry image files here, unlike
  // the top-level user image used by chat-completions protocols.
  const { output: _output, ...envelope } = part
  return (
    estimateSerializedChars(envelope) +
    output.value.reduce((chars, item: unknown) => {
      if (
        item &&
        typeof item === 'object' &&
        'type' in item &&
        typeof item.type === 'string' &&
        ['file', 'image-data', 'image-url', 'file-data', 'file-url', 'audio-data', 'video-data', 'video-url'].includes(
          item.type
        )
      ) {
        return chars + MEDIA_PART_OVERHEAD_CHARS
      }
      return chars + estimateSerializedChars(item)
    }, 0)
  )
}

function estimateContentChars(content: ModelMessage['content']): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return estimateSerializedChars(content)
  return content.reduce((chars, part) => chars + estimateProtocolPartChars(part), 0)
}

export function estimateModelMessageTokens(message: ModelMessage): number {
  return Math.ceil(estimateContentChars(message.content) / CHARS_PER_TOKEN) + PER_MESSAGE_OVERHEAD_TOKENS
}

export function estimateModelMessagesTokens(messages: ModelMessage[]): number {
  let total = 0
  for (const message of messages) {
    total += estimateModelMessageTokens(message)
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
export function findKeptModelMessageStartIndex(messages: ModelMessage[], keepRecentTokens: number): number {
  if (messages.length === 0 || keepRecentTokens <= 0) {
    return messages.length
  }

  let tokens = 0
  let start = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const next = estimateModelMessageTokens(messages[index])
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
