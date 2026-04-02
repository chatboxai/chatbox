// TODO: Migrate tests to use msw instead of @ai-sdk/provider-utils/test createTestServer
// The createTestServer utility was removed in AI SDK v6
import type { ModelDependencies } from 'src/shared/types/adapters'
import type { ProviderModelInfo } from 'src/shared/types/settings'
import { createNoopLangSmithAdapter } from 'src/shared/utils/langsmith_adapter'
import type { SentryScope } from 'src/shared/utils/sentry_adapter'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OpenAI from './openai'

describe.skip('OpenAI Adapter', () => {
  let dependencies: ModelDependencies
  let openai: OpenAI

  const server = {
    urls: {} as Record<string, { response: unknown }>,
  }

  beforeEach(() => {
    vi.clearAllMocks()

    dependencies = {
      request: {
        apiRequest: async (options) =>
          fetch(options.url, {
            method: options.method,
            headers: options.headers as HeadersInit,
            body: options.body as BodyInit,
          }),
        fetchWithOptions: async (url, options) => fetch(url, options as RequestInit),
      },
      storage: {
        saveImage: vi.fn().mockResolvedValue('mock-storage-key'),
        getImage: vi.fn().mockResolvedValue('https://example.com/image.png'),
      },
      sentry: {
        withScope: vi.fn((callback: (scope: SentryScope) => void) => callback({ setTag: vi.fn(), setExtra: vi.fn() })),
        captureException: vi.fn(),
      },
      langsmith: createNoopLangSmithAdapter(),
      getRemoteConfig: vi.fn().mockReturnValue({ setting_chatboxai_first: false }),
    }
  })

  const createOpenAI = (overrides: Record<string, unknown> = {}) => {
    const model: ProviderModelInfo = {
      modelId: (overrides.modelId as string) || 'gpt-4',
      type: 'chat',
      capabilities: overrides.capabilities as ProviderModelInfo['capabilities'],
    }
    return new OpenAI(
      {
        apiKey: 'test-api-key',
        apiHost: 'https://api.openai.com',
        model,
        dalleStyle: 'vivid',
        injectDefaultMetadata: true,
        useProxy: false,
        stream: false,
        ...overrides,
      },
      dependencies
    )
  }

  describe('Text Messages', () => {
    it('should handle simple text messages', async () => {
      server.urls['https://api.openai.com/v1/chat/completions'].response = {
        type: 'json-value',
        body: {
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1677652288,
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello world' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        },
      }

      openai = createOpenAI()
      const result = await openai.chat(
        [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'Hello' },
        ],
        {}
      )

      expect(result.contentParts).toEqual([{ type: 'text', text: 'Hello world' }])
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2, totalTokens: 12 })
    })

    it('should handle multimodal messages with images', async () => {
      server.urls['https://api.openai.com/v1/chat/completions'].response = {
        type: 'json-value',
        body: {
          id: 'chatcmpl-456',
          object: 'chat.completion',
          created: 1677652288,
          model: 'gpt-4-vision-preview',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'I see an image' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        },
      }

      openai = createOpenAI({ modelId: 'gpt-4-vision-preview', capabilities: ['vision'] })
      const result = await openai.chat(
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this image?' },
              { type: 'image', image: 'https://example.com/test-image.jpg' },
            ],
          },
        ],
        {}
      )

      expect(result.contentParts).toEqual([{ type: 'text', text: 'I see an image' }])
    })
  })

  describe('Streaming', () => {
    it('should parse streaming text response', async () => {
      server.urls['https://api.openai.com/v1/chat/completions'].response = {
        type: 'stream-chunks',
        chunks: [
          `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n`,
          `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"The"},"finish_reason":null}]}\n\n`,
          `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" answer"},"finish_reason":null}]}\n\n`,
          `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" is"},"finish_reason":null}]}\n\n`,
          `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" 42"},"finish_reason":null}]}\n\n`,
          `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`,
          `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\n`,
          'data: [DONE]\n\n',
        ],
      }

      openai = createOpenAI({ stream: true })
      const onResultChange = vi.fn()
      const result = await openai.chat([{ role: 'user', content: 'What is the meaning of life?' }], { onResultChange })

      expect(onResultChange).toHaveBeenCalled()
      expect(result.contentParts).toEqual([{ type: 'text', text: 'The answer is 42' }])
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14 })
    })

    it('should handle tool calls in streaming response', async () => {
      server.urls['https://api.openai.com/v1/chat/completions'].response = ({ callNumber }: { callNumber: number }) => {
        if (callNumber === 0) {
          return {
            type: 'stream-chunks',
            chunks: [
              `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n`,
              `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":"{\\"location\\":\\"Tokyo\\"}"}}]},"finish_reason":null}]}\n\n`,
              `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n`,
              `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[],"usage":{"prompt_tokens":20,"completion_tokens":15,"total_tokens":35}}\n\n`,
              'data: [DONE]\n\n',
            ],
          }
        }
        return {
          type: 'stream-chunks',
          chunks: [
            `data: {"id":"chatcmpl-456","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n`,
            `data: {"id":"chatcmpl-456","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"The weather in Tokyo is sunny."},"finish_reason":null}]}\n\n`,
            `data: {"id":"chatcmpl-456","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`,
            `data: {"id":"chatcmpl-456","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[],"usage":{"prompt_tokens":40,"completion_tokens":10,"total_tokens":50}}\n\n`,
            'data: [DONE]\n\n',
          ],
        }
      }

      openai = createOpenAI({ stream: true, capabilities: ['tool_use'] })
      const result = await openai.chat([{ role: 'user', content: 'What is the weather in Tokyo?' }], {})

      const toolCallParts = result.contentParts.filter((part) => part.type === 'tool-call')
      expect(toolCallParts.length).toBeGreaterThan(0)

      const toolCall = toolCallParts[0] as { type: string; toolCallId: string; toolName: string; args: string }
      expect(toolCall.toolCallId).toBe('call_abc')
      expect(toolCall.toolName).toBe('get_weather')
      expect(toolCall.args).toEqual({ location: 'Tokyo' })
    })
  })

  describe('Error Handling', () => {
    it('should handle 401 unauthorized error', async () => {
      server.urls['https://api.openai.com/v1/chat/completions'].response = {
        type: 'error',
        status: 401,
        body: JSON.stringify({
          error: {
            message: 'Invalid API key provided',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        }),
      }

      openai = createOpenAI({ apiKey: 'invalid-key' })
      await expect(openai.chat([{ role: 'user', content: 'Hello' }], {})).rejects.toThrow()
      expect(dependencies.sentry.captureException).toHaveBeenCalled()
    })

    it('should handle 429 rate limit error', { timeout: 10000 }, async () => {
      server.urls['https://api.openai.com/v1/chat/completions'].response = {
        type: 'error',
        status: 429,
        body: JSON.stringify({
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
            code: 'rate_limit',
          },
        }),
      }

      openai = createOpenAI()
      await expect(openai.chat([{ role: 'user', content: 'Hello' }], {})).rejects.toThrow()
    })
  })
})
