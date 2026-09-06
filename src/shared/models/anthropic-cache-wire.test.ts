import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, type ModelMessage, streamText } from 'ai'
import { describe, expect, it } from 'vitest'
import { addAnthropicCacheControl } from './anthropic-cache'

const messages: ModelMessage[] = [
  { role: 'system', content: 'Stable instructions' },
  { role: 'user', content: 'First turn' },
  { role: 'assistant', content: [{ type: 'text', text: 'Answer' }] },
  { role: 'user', content: 'Next turn' },
]

const responseMessage = {
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-5',
  content: [{ type: 'text', text: 'OK' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
}

function streamResponse(): Response {
  const events = [
    { type: 'message_start', message: { ...responseMessage, content: [], stop_reason: null } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('Anthropic cache TTL wire serialization', () => {
  for (const ttl of ['5m', '1h'] as const) {
    for (const streaming of [false, true]) {
      it(`sends ${ttl} breakpoints with stream=${streaming}`, async () => {
        const bodies: Array<{
          system: Array<{ cache_control?: unknown }>
          messages: Array<{ content: Array<{ cache_control?: unknown }> }>
        }> = []
        const provider = createAnthropic({
          apiKey: 'test-key-not-a-secret',
          baseURL: 'https://example.invalid/v1',
          fetch: (_url, init) => {
            bodies.push(JSON.parse(String(init?.body)))
            return Promise.resolve(streaming ? streamResponse() : Response.json(responseMessage))
          },
        })
        const options = {
          model: provider('claude-sonnet-4-5'),
          messages: addAnthropicCacheControl(messages, ttl),
          maxOutputTokens: 16,
          maxRetries: 0,
        }
        const text = streaming ? await streamText(options).text : (await generateText(options)).text
        expect(text).toBe('OK')
        expect(bodies).toHaveLength(1)
        const body = bodies[0]
        const controls = [...body.system, ...body.messages.flatMap((message) => message.content)]
          .map((part) => part.cache_control)
          .filter(Boolean)
        const expected = { type: 'ephemeral', ...(ttl === '1h' ? { ttl: '1h' } : {}) }
        expect(controls).toEqual([expected, expected, expected])
      })
    }
  }
})
