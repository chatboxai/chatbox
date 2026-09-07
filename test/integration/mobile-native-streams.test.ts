import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { maybeWrapGeminiErrorResponse } from '@shared/models/utils/gemini-stream-error'
import { createOpenAIChatCompletionSseFetch } from '@shared/models/utils/openai-chat-sse-termination'
import { streamText } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Headers as LegacyHeaders, Response as LegacyResponse } from 'whatwg-fetch'
import { installStreamingResponsePolyfill } from '../../apps/mobile/src/polyfills/streaming-response'

const ModernResponse = Response
const encoder = new TextEncoder()

beforeEach(() => {
  vi.stubGlobal('Response', LegacyResponse)
  vi.stubGlobal('Headers', LegacyHeaders)
  installStreamingResponsePolyfill()
})
afterEach(() => vi.unstubAllGlobals())

describe('RN response construction through shared provider streams', () => {
  it('lets the OpenAI SSE wrapper and AI SDK finish at DONE without HTTP EOF', async () => {
    const cancel = vi.fn()
    const fetch = createOpenAIChatCompletionSseFetch(
      async () =>
        new ModernResponse(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"id":"chat-1","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"RN_STREAM_OK"},"finish_reason":null}]}\n\n' +
                    'data: {"id":"chat-1","created":1,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n' +
                    'data: [DONE]\n\n'
                )
              )
            },
            cancel,
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
    )
    const model = createOpenAICompatible({ name: 'test', baseURL: 'https://example.com/v1', fetch }).chatModel('test')
    const result = streamText({ model, prompt: 'hello', maxRetries: 0 })
    await expect(result.text).resolves.toBe('RN_STREAM_OK')
    await expect(result.finishReason).resolves.toBe('stop')
    await expect(result.totalUsage).resolves.toMatchObject({ inputTokens: 2, outputTokens: 1 })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it('preserves Gemini mid-stream error detection', async () => {
    const native = new ModernResponse(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"error":{"code":429,"message":"quota exceeded","status":"RESOURCE_EXHAUSTED"}}\n\n')
          )
          controller.close()
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } }
    )
    const response = maybeWrapGeminiErrorResponse('https://example.com/models/gemini:streamGenerateContent', native)
    await expect(response.text()).rejects.toThrow()
  })
})
