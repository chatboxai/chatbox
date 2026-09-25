import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText } from 'ai'
import { expect, test } from 'vitest'

const fallbackStream = [
  {
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: 'msg_fallback',
        type: 'message',
        role: 'assistant',
        model: 'claude-fable-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 1,
        },
      },
    },
  },
  {
    event: 'content_block_start',
    data: {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'fallback',
        from: { model: 'claude-fable-5' },
        to: { model: 'claude-opus-4-8' },
        trigger: { type: 'refusal', category: 'bio' },
      },
    },
  },
  {
    event: 'content_block_stop',
    data: { type: 'content_block_stop', index: 0 },
  },
  {
    event: 'content_block_start',
    data: {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'text', text: '' },
    },
  },
  {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: 'Fallback answer' },
    },
  },
  {
    event: 'content_block_stop',
    data: { type: 'content_block_stop', index: 1 },
  },
  {
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        iterations: [
          {
            type: 'message',
            model: 'claude-fable-5',
            input_tokens: 10,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          {
            type: 'fallback_message',
            model: 'claude-opus-4-8',
            input_tokens: 10,
            output_tokens: 4,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        ],
      },
    },
  },
  {
    event: 'message_stop',
    data: { type: 'message_stop' },
  },
]
  .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}`)
  .join('\n\n')

test('continues streaming when Anthropic switches to a server-side fallback model', async () => {
  const anthropic = createAnthropic({
    apiKey: 'test-key',
    fetch: async () =>
      new Response(`${fallbackStream}\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      }),
  })

  const result = streamText({
    model: anthropic('claude-fable-5'),
    prompt: 'Hello',
  })

  const chunks = []
  for await (const chunk of result.stream) {
    chunks.push(chunk)
  }

  expect(chunks.filter((chunk) => chunk.type === 'error')).toEqual([])
  expect(
    chunks
      .filter((chunk) => chunk.type === 'text-delta')
      .map((chunk) => chunk.text)
      .join('')
  ).toBe('Fallback answer')
})
