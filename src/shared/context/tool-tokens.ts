import type { Message, MessageContentToolCallPart } from '../types'

/**
 * Rough per-part token overhead of a serialized tool call on the wire
 * (ids, names, structural framing).
 */
const TOOL_CALL_PART_OVERHEAD_TOKENS = 8

/** chars-per-token heuristic; precision is not needed for pressure thresholds. */
const CHARS_PER_TOKEN = 4

// Tool parts are immutable snapshots once settled — message updates replace the
// part objects — so identity-keyed memoization stays correct and keeps repeated
// estimation passes (per keystroke / per submit) from re-serializing large results.
const partTokenCache = new WeakMap<object, number>()

function serializedLength(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'string') return value.length
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

/**
 * Estimate the wire-token weight of a single tool-call part (call args plus the
 * inline result). Message-text token caches (`tokenCountMap`) only cover text
 * parts, so tool weight must be added separately wherever context size is
 * measured for pressure decisions.
 */
export function estimateToolCallPartTokens(part: MessageContentToolCallPart): number {
  const cached = partTokenCache.get(part)
  if (cached !== undefined) {
    return cached
  }

  let chars = serializedLength(part.args)
  if (part.state === 'result' || part.state === 'error') {
    chars += serializedLength(part.result)
  }

  const tokens = Math.ceil(chars / CHARS_PER_TOKEN) + TOOL_CALL_PART_OVERHEAD_TOKENS
  partTokenCache.set(part, tokens)
  return tokens
}

/** Sum of {@link estimateToolCallPartTokens} over all tool-call parts of a message. */
export function estimateMessageToolCallTokens(message: Message): number {
  const parts = message.contentParts
  if (!parts || parts.length === 0) {
    return 0
  }

  let total = 0
  for (const part of parts) {
    if (part.type === 'tool-call') {
      total += estimateToolCallPartTokens(part)
    }
  }
  return total
}
