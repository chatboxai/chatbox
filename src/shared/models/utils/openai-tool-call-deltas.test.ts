import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { describe, expect, it } from 'vitest'
import { createOpenAIChatCompletionSseFetch } from './openai-chat-sse-termination'

function responseFor(deltas: unknown[]): Response {
  const events: unknown[] = deltas.map((delta) => ({
    id: 'chat-probe',
    model: 'deepseek-v4.1-flash',
    choices: [{ index: 0, delta, finish_reason: null }],
  }))
  events.push({
    id: 'chat-probe',
    model: 'deepseek-v4.1-flash',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  })
  return new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

const header = { index: 0, id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '' } }
const continuation = { index: 0, id: '', type: '', function: { name: '', arguments: '{"city":' } }

describe('tool call argument deltas', () => {
  for (const family of ['deepseek', 'compatible'] as const) {
    it(`preserves arguments when ${family} repeats empty metadata in a continuation`, async () => {
      const fetch = createOpenAIChatCompletionSseFetch(async () =>
        responseFor([
          { tool_calls: [header] },
          { tool_calls: [continuation] },
          { tool_calls: [{ ...continuation, function: { name: '', arguments: '"Paris"}' } }] },
        ])
      )
      const model =
        family === 'deepseek'
          ? createDeepSeek({ apiKey: 'test-key', fetch }).chat('deepseek-v4.1-flash')
          : createOpenAICompatible({ name: 'test', baseURL: 'https://example.test/v1', apiKey: 'test-key', fetch })(
              'deepseek-v4.1-flash'
            )
      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'weather' }] }],
        tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object' } }],
      })
      const events = []
      const reader = stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        events.push(value)
      }
      reader.releaseLock()
      expect(events.filter((event) => event.type === 'error')).toEqual([])
      expect(events.filter((event) => event.type === 'tool-call')).toEqual([
        expect.objectContaining({ toolCallId: 'call-1', toolName: 'lookup', input: '{"city":"Paris"}' }),
      ])
    })
  }

  it.each([
    ['first chunk', [continuation]],
    ['different call', [header, { ...continuation, id: 'call-2' }]],
    ['different name', [header, { ...continuation, function: { name: 'other', arguments: '{}' } }]],
    ['unsupported type', [header, { ...continuation, type: 'custom' }]],
  ] as const)('keeps invalid metadata visible to validation: %s', async (_name, calls) => {
    const response = responseFor(calls.map((call) => ({ tool_calls: [call] })))
    const expected = await response.clone().text()
    const fetch = createOpenAIChatCompletionSseFetch(async () => response)
    const result = await fetch('https://example.test/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ stream: true }),
    })
    expect(await result.text()).toBe(expected.replace('data: [DONE]\n\n', ''))
  })
  it('does not borrow a tool header from another choice or index', async () => {
    const initial = { choices: [{ index: 0, delta: { tool_calls: [header] } }] }
    for (const next of [
      { choices: [{ index: 1, delta: { tool_calls: [continuation] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ ...continuation, index: 1 }] } }] },
    ]) {
      const payload = `data: ${JSON.stringify(initial)}\n\ndata: ${JSON.stringify(next)}\n\ndata: [DONE]\n\n`
      const fetch = createOpenAIChatCompletionSseFetch(
        async () => new Response(payload, { headers: { 'content-type': 'text/event-stream' } })
      )
      const result = await fetch('https://example.test/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ stream: true }),
      })
      expect(await result.text()).toBe(payload.replace('data: [DONE]\n\n', ''))
    }
  })
})
