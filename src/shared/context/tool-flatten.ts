import type { Message, MessageContentParts, MessageContentToolCallPart } from '../types'

/** Longest serialized tool args preview kept when flattening tool calls to text. */
export const TOOL_FLATTEN_ARGS_PREVIEW_CHARS = 500
/** Longest serialized tool result preview kept when flattening tool calls to text. */
export const TOOL_FLATTEN_RESULT_PREVIEW_CHARS = 1500

function serializeForPreview(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

function truncatePreview(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…[truncated, ${text.length} chars total]`
}

function flattenToolCallPart(part: MessageContentToolCallPart): string | null {
  // Incomplete calls carry no durable information worth carrying forward.
  if (part.state === 'call' || part.state === 'paused') return null

  const args = truncatePreview(serializeForPreview(part.args), TOOL_FLATTEN_ARGS_PREVIEW_CHARS)
  const outcome = truncatePreview(serializeForPreview(part.result), TOOL_FLATTEN_RESULT_PREVIEW_CHARS)
  const outcomeLabel = part.state === 'error' ? 'error' : 'result'

  const lines = [`[tool ${part.toolName}]`]
  if (args) lines.push(`args: ${args}`)
  lines.push(`${outcomeLabel}: ${outcome || '(empty)'}`)
  return lines.join('\n')
}

/**
 * Fold tool-call parts into bounded plain text inside their assistant turn.
 *
 * Providers such as Anthropic reject tool_use/tool_result wire blocks when the
 * request declares no `tools`, so any request without a tool set must carry the
 * tool history as text instead. Two callers rely on this: the compaction
 * summarizer (its dedicated, often small model never declares tools, yet tool
 * calls and results are the primary carriers of task state it must see) and
 * the generation harness when the current request registers no tools (tools
 * disabled, or a model without tool support). Incomplete calls (state
 * 'call'/'paused') carry no durable information and are dropped; large
 * payloads are cut to previews to respect the receiving model's window.
 */
export function flattenToolCallPartsToText(messages: Message[]): Message[] {
  return messages.map((message) => {
    const parts = message.contentParts
    if (!parts || !parts.some((part) => part.type === 'tool-call')) {
      return message
    }

    const flattened: MessageContentParts = []
    for (const part of parts) {
      if (part.type !== 'tool-call') {
        flattened.push(part)
        continue
      }
      const text = flattenToolCallPart(part)
      if (text) {
        flattened.push({ type: 'text', text })
      }
    }

    return { ...message, contentParts: flattened }
  })
}
