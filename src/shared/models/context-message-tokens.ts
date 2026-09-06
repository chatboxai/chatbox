import type { ModelMessage } from 'ai'

/**
 * Pressure estimates, not billing/tokenizer counts. Binary payload length says
 * nothing about vision/audio/document tokens, so use a bounded allowance per
 * media part until the provider supplies a model-specific estimate.
 */
export const MEDIA_PART_ESTIMATE_TOKENS = 4_096
const CHARS_PER_TOKEN = 4
const PART_OVERHEAD_TOKENS = 8
const MESSAGE_OVERHEAD_TOKENS = 4

function textTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function jsonTokens(value: unknown): number {
  try {
    return textTokens(JSON.stringify(value) ?? '')
  } catch {
    return 0
  }
}

type ToolOutput = Extract<Extract<ModelMessage, { role: 'tool' }>['content'][number], { type: 'tool-result' }>['output']

export function estimateToolOutputTokens(output: ToolOutput): number {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return textTokens(output.value)
    case 'json':
    case 'error-json':
      // Arbitrary JSON remains text on the wire. Only typed media parts may
      // exclude their payload; never silently discount long tool-result text.
      return jsonTokens(output.value)
    case 'content':
      return output.value.reduce(
        (total, part) =>
          total + PART_OVERHEAD_TOKENS + (part.type === 'text' ? textTokens(part.text) : MEDIA_PART_ESTIMATE_TOKENS),
        0
      )
    default:
      return PART_OVERHEAD_TOKENS
  }
}

// Settled messages are immutable during one run. Do not serialize base64 or
// Uint8Array data, nor provider replay metadata such as encrypted reasoning.
const messageTokenCache = new WeakMap<object, number>()

export function estimateModelMessageTokens(message: ModelMessage): number {
  const cached = messageTokenCache.get(message)
  if (cached !== undefined) return cached

  let tokens = MESSAGE_OVERHEAD_TOKENS
  if (typeof message.content === 'string') {
    tokens += textTokens(message.content)
  } else {
    for (const part of message.content) {
      tokens += PART_OVERHEAD_TOKENS
      switch (part.type) {
        case 'text':
        case 'reasoning':
          tokens += textTokens(part.text)
          break
        case 'image':
        case 'file':
          tokens += MEDIA_PART_ESTIMATE_TOKENS
          break
        case 'tool-call':
          tokens += jsonTokens(part.input)
          break
        case 'tool-result':
          tokens += estimateToolOutputTokens(part.output)
          break
      }
    }
  }
  messageTokenCache.set(message, tokens)
  return tokens
}
