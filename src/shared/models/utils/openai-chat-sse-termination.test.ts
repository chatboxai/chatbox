import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText, tool } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createOpenAIChatCompletionSseFetch,
  maybeWrapOpenAIChatCompletionSseResponse,
  wrapOpenAIChatCompletionSse,
} from './openai-chat-sse-termination'

const encoder = new TextEncoder()

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    output += decoder.decode(value, { stream: true })
  }
  return output + decoder.decode()
}

function heldOpenStream(chunks: string[], onCancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
    },
    cancel() {
      onCancel()
    },
  })
}

describe('OpenAI Chat SSE logical termination', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ends a held-open stream at a complete DONE event and cancels its source', async () => {
    const onCancel = vi.fn()
    const input = heldOpenStream(['data: {"value":"answer"}\n\n', 'data: [DONE]\n\n'], onCancel)

    await expect(readAll(wrapOpenAIChatCompletionSse(input))).resolves.toBe('data: {"value":"answer"}\n\n')
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
  })

  it('recognizes a DONE event split across byte chunks with CRLF framing', async () => {
    const onCancel = vi.fn()
    const input = heldOpenStream(['data: {"value":"answer"}\r\n\r\n', 'data: [DO', 'NE]\r', '\n\r\n'], onCancel)

    await expect(readAll(wrapOpenAIChatCompletionSse(input))).resolves.toBe('data: {"value":"answer"}\r\n\r\n')
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
  })

  it('does not treat a DONE string inside JSON as the terminal event', async () => {
    const payload = 'data: {"content":"[DONE]"}\n\ndata: {"content":"after"}\n\n'
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload))
        controller.close()
      },
    })

    await expect(readAll(wrapOpenAIChatCompletionSse(input))).resolves.toBe(payload)
  })

  it('does not wrap non-chat or non-streaming responses', () => {
    const response = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
    const eventStreamResponse = new Response('data: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    })

    expect(maybeWrapOpenAIChatCompletionSseResponse('https://example.com/v1/responses', undefined, response)).toBe(
      response
    )
    expect(
      maybeWrapOpenAIChatCompletionSseResponse(
        'https://example.com/v1/chat/completions',
        { method: 'POST', body: '{"stream":false}' },
        response
      )
    ).toBe(response)
    expect(
      maybeWrapOpenAIChatCompletionSseResponse(
        'https://example.com/v1/chat/completions',
        { method: 'POST', body: '{"stream":false}' },
        eventStreamResponse
      )
    ).toBe(eventStreamResponse)
  })

  it('returns the original stream when TransformStream is unavailable', () => {
    const input = new ReadableStream<Uint8Array>()
    vi.stubGlobal('TransformStream', undefined)

    expect(wrapOpenAIChatCompletionSse(input)).toBe(input)
  })

  it('lets AI SDK finish and retain terminal metadata without HTTP EOF', async () => {
    const onCancel = vi.fn()
    const fetch = createOpenAIChatCompletionSseFetch(
      vi.fn(
        async () =>
          new Response(
            heldOpenStream(
              [
                'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":null}]}\n\n',
                'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n',
                'data: [DONE]\n\n',
              ],
              onCancel
            ),
            { headers: { 'content-type': 'text/event-stream' } }
          )
      )
    )
    const model = createOpenAICompatible({
      name: 'test-compatible',
      apiKey: 'test-key',
      baseURL: 'https://example.com/v1',
      fetch,
    }).chatModel('model')
    const result = streamText({ model, prompt: 'hello', maxRetries: 0 })
    const parts = []

    for await (const part of result.fullStream) parts.push(part)

    expect(parts.some((part) => part.type === 'finish')).toBe(true)
    await expect(result.text).resolves.toBe('answer')
    await expect(result.finishReason).resolves.toBe('stop')
    await expect(result.totalUsage).resolves.toMatchObject({ inputTokens: 2, outputTokens: 1, totalTokens: 3 })
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
  })

  it('retains a held-open tool call, tool-calls finish reason, and usage before DONE', async () => {
    const onCancel = vi.fn()
    const fetch = createOpenAIChatCompletionSseFetch(
      vi.fn(
        async () =>
          new Response(
            heldOpenStream(
              [
                'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"Paris\\"}"}}]},"finish_reason":null}]}\n\n',
                'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
                'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"model","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}\n\n',
                'data: [DONE]\n\n',
              ],
              onCancel
            ),
            { headers: { 'content-type': 'text/event-stream' } }
          )
      )
    )
    const model = createOpenAICompatible({
      name: 'test-compatible',
      apiKey: 'test-key',
      baseURL: 'https://example.com/v1',
      fetch,
    }).chatModel('model')
    const result = streamText({
      model,
      prompt: 'What is the weather?',
      maxRetries: 0,
      tools: {
        get_weather: tool({
          description: 'Get the weather for a city.',
          inputSchema: z.object({ city: z.string() }),
        }),
      },
    })
    const parts = []

    for await (const part of result.fullStream) parts.push(part)

    expect(parts).toContainEqual(
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'get_weather',
        input: { city: 'Paris' },
      })
    )
    await expect(result.finishReason).resolves.toBe('tool-calls')
    await expect(result.totalUsage).resolves.toMatchObject({ inputTokens: 4, outputTokens: 3, totalTokens: 7 })
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
  })
})
