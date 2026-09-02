import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import {
  flattenToolCallPartsToText,
  TOOL_FLATTEN_ARGS_PREVIEW_CHARS,
  TOOL_FLATTEN_RESULT_PREVIEW_CHARS,
} from './tool-flatten'

function assistantWithToolCall(overrides: Record<string, unknown> = {}): Message {
  return {
    id: 'a1',
    role: 'assistant',
    contentParts: [
      { type: 'text', text: 'Let me check.' },
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'tc-1',
        toolName: 'read_file',
        args: { path: '/etc/hosts' },
        result: { content: 'localhost entries' },
        ...overrides,
      },
    ],
  }
}

describe('flattenToolCallPartsToText', () => {
  it('passes through messages without tool calls by reference', () => {
    const message: Message = { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'hi' }] }
    const result = flattenToolCallPartsToText([message])
    expect(result[0]).toBe(message)
  })

  it('flattens tool calls into text the summarizer can read without tool wire blocks', () => {
    const result = flattenToolCallPartsToText([assistantWithToolCall()])

    const parts = result[0].contentParts ?? []
    expect(parts.some((part) => part.type === 'tool-call')).toBe(false)
    const flattened = parts.find((part) => part.type === 'text' && part.text.includes('[tool read_file]'))
    expect(flattened).toBeDefined()
    expect((flattened as { text: string }).text).toContain('/etc/hosts')
    expect((flattened as { text: string }).text).toContain('localhost entries')
  })

  it('labels error outcomes and drops incomplete calls', () => {
    const withError = flattenToolCallPartsToText([assistantWithToolCall({ state: 'error', result: 'boom' })])
    const errorText = (withError[0].contentParts ?? []).find(
      (part) => part.type === 'text' && part.text.includes('[tool')
    )
    expect((errorText as { text: string }).text).toContain('error: boom')

    const withPending = flattenToolCallPartsToText([assistantWithToolCall({ state: 'call', result: undefined })])
    const pendingParts = withPending[0].contentParts ?? []
    expect(pendingParts.some((part) => part.type === 'text' && part.text.includes('[tool'))).toBe(false)
  })

  it('truncates oversized args and results to previews', () => {
    const result = flattenToolCallPartsToText([
      assistantWithToolCall({
        args: { blob: 'a'.repeat(TOOL_FLATTEN_ARGS_PREVIEW_CHARS * 3) },
        result: 'b'.repeat(TOOL_FLATTEN_RESULT_PREVIEW_CHARS * 3),
      }),
    ])

    const flattened = (result[0].contentParts ?? []).find(
      (part) => part.type === 'text' && part.text.includes('[tool read_file]')
    ) as { text: string }
    expect(flattened.text).toContain('[truncated')
    expect(flattened.text.length).toBeLessThan(
      TOOL_FLATTEN_ARGS_PREVIEW_CHARS + TOOL_FLATTEN_RESULT_PREVIEW_CHARS + 300
    )
  })
})
