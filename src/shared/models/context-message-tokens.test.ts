import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  estimateModelMessageTokens,
  estimateToolOutputTokens,
  MEDIA_PART_ESTIMATE_TOKENS,
} from './context-message-tokens'

function imageMessage(image: string | Uint8Array | URL): ModelMessage {
  return { role: 'user', content: [{ type: 'image', image, mediaType: 'image/png' }] }
}

describe('multimodal pressure estimates', () => {
  it('does not count base64, data URLs, binary buffers or remote URLs as image text', () => {
    const small = estimateModelMessageTokens(imageMessage('AA=='))
    for (const image of [
      'A'.repeat(3_000_000),
      `data:image/png;base64,${'A'.repeat(3_000_000)}`,
      new Uint8Array(3_000_000),
      new URL('https://example.invalid/image.png'),
    ]) {
      expect(estimateModelMessageTokens(imageMessage(image))).toBe(small)
    }
    expect(small).toBeGreaterThanOrEqual(MEDIA_PART_ESTIMATE_TOKENS)
  })

  it('does not serialize media buffers to estimate them', () => {
    const bytes = new Uint8Array(10)
    Object.defineProperty(bytes, 'toJSON', {
      value: () => {
        throw new Error('must not serialize media')
      },
    })
    expect(estimateModelMessageTokens(imageMessage(bytes))).toBe(estimateModelMessageTokens(imageMessage('AA==')))
  })

  it('uses a bounded allowance for file/audio parts while retaining text weight', () => {
    const message = (data: string): ModelMessage => ({
      role: 'user',
      content: [
        { type: 'file', data, mediaType: 'audio/wav' },
        { type: 'text', text: 'x'.repeat(40_000) },
      ],
    })
    expect(estimateModelMessageTokens(message('A'.repeat(3_000_000)))).toBe(estimateModelMessageTokens(message('AA==')))
    expect(estimateModelMessageTokens(message('AA=='))).toBeGreaterThan(10_000)
  })

  it('counts plain text and arbitrary JSON tool results in full', () => {
    expect(estimateToolOutputTokens({ type: 'text', value: 'x'.repeat(40_000) })).toBe(10_000)
    expect(estimateToolOutputTokens({ type: 'json', value: { data: 'x'.repeat(40_000) } })).toBeGreaterThan(10_000)
    expect(estimateModelMessageTokens({ role: 'system', content: 'x'.repeat(40_000) })).toBeGreaterThan(10_000)
  })

  it('estimates typed media inside tool output without its encoded payload', () => {
    const output = (data: string) => ({
      type: 'content' as const,
      value: [
        { type: 'text' as const, text: 'x'.repeat(4_000) },
        { type: 'image-data' as const, data, mediaType: 'image/png' },
      ],
    })
    expect(estimateToolOutputTokens(output('A'.repeat(3_000_000)))).toBe(estimateToolOutputTokens(output('AA==')))
    expect(estimateToolOutputTokens(output('AA=='))).toBeGreaterThan(MEDIA_PART_ESTIMATE_TOKENS + 1_000)
  })

  it('excludes replay metadata but counts reasoning and tool inputs', () => {
    const message: ModelMessage = {
      role: 'assistant',
      content: [
        {
          type: 'reasoning',
          text: 'x'.repeat(4_000),
          providerOptions: { openai: { encryptedContent: 'a'.repeat(1_000_000) } },
        },
        { type: 'tool-call', toolCallId: 't1', toolName: 'write_file', input: { content: 'x'.repeat(40_000) } },
      ],
    }
    expect(estimateModelMessageTokens(message)).toBeGreaterThan(11_000)
    expect(estimateModelMessageTokens(message)).toBeLessThan(12_000)
  })
})
