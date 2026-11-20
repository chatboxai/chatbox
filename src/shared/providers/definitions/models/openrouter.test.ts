import type { ModelDependencies } from '@shared/types/adapters'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import type { ModelMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import OpenRouter from './openrouter'

const messages: ModelMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: [{ type: 'text', text: 'first question' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
  { role: 'user', content: [{ type: 'text', text: 'second question' }] },
]

const usage = {
  prompt_tokens: 5000,
  completion_tokens: 10,
  total_tokens: 5010,
  prompt_tokens_details: { cached_tokens: 4800 },
}

type RequestBody = {
  messages: {
    role: string
    content: string | { type: string; text?: string; cache_control?: unknown }[]
    cache_control?: unknown
  }[]
}

function createDependencies(): ModelDependencies {
  return {
    request: {
      apiRequest: vi.fn(),
      fetchWithOptions: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn((callback: (scope: SentryScope) => void) =>
        callback({
          setTag: vi.fn(),
          setExtra: vi.fn(),
        })
      ),
    },
    getRemoteConfig: vi.fn(),
    platformType: 'desktop',
  }
}

function createStreamingFetch() {
  return vi.fn<typeof globalThis.fetch>(() => {
    const chunks = [
      'data: {"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"answer"},"finish_reason":null}]}\n\n',
      `data: {"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":${JSON.stringify(usage)}}\n\n`,
      'data: [DONE]\n\n',
    ]
    const encoder = new TextEncoder()
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
            controller.close()
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    )
  })
}

function createJsonFetch() {
  return vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(
      Response.json({
        id: 'gen-1',
        object: 'chat.completion',
        created: 1,
        model: 'test-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }],
        usage,
      })
    )
  )
}

function createModel(modelId: string, customFetch: typeof globalThis.fetch, stream?: boolean): OpenRouter {
  return new OpenRouter(
    {
      apiKey: 'test-key',
      model: { modelId, type: 'chat' },
      stream,
      customFetch,
    },
    createDependencies()
  )
}

function getRequestBody(customFetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>): RequestBody {
  return JSON.parse(String(customFetch.mock.calls[0]?.[1]?.body)) as RequestBody
}

function getCacheControls(body: RequestBody): unknown[] {
  return body.messages.map((message) =>
    Array.isArray(message.content) ? message.content.at(-1)?.cache_control : undefined
  )
}

describe('OpenRouter prompt caching', () => {
  it('sends Anthropic cache breakpoints for streamed Claude requests', async () => {
    const customFetch = createStreamingFetch()
    const model = createModel('anthropic/claude-sonnet-4.5', customFetch)

    for await (const _part of model.chatStream(messages, {})) {
      // drain the stream
    }

    expect(getCacheControls(getRequestBody(customFetch))).toEqual([
      { type: 'ephemeral' },
      { type: 'ephemeral' },
      undefined,
      { type: 'ephemeral' },
    ])
  })

  it('reports cached prompt tokens for streamed Claude requests', async () => {
    const customFetch = createStreamingFetch()
    const result = await createModel('anthropic/claude-sonnet-4.5', customFetch).chat(messages, {})

    expect(getCacheControls(getRequestBody(customFetch))[0]).toEqual({ type: 'ephemeral' })
    expect(result.usage).toMatchObject({ inputTokens: 5000, cachedInputTokens: 4800 })
  })

  it('sends cache breakpoints and reports cached tokens for non-streaming Claude requests', async () => {
    const customFetch = createJsonFetch()
    const result = await createModel('anthropic/claude-opus-4.1', customFetch, false).chat(messages, {})

    const body = getRequestBody(customFetch)
    expect(body).not.toHaveProperty('stream', true)
    expect(getCacheControls(body)).toEqual([
      { type: 'ephemeral' },
      { type: 'ephemeral' },
      undefined,
      { type: 'ephemeral' },
    ])
    expect(result.usage).toMatchObject({ inputTokens: 5000, cachedInputTokens: 4800 })
  })

  it('leaves non-Claude requests without cache breakpoints', async () => {
    const customFetch = createStreamingFetch()
    const model = createModel('openai/gpt-5', customFetch)

    for await (const _part of model.chatStream(messages, {})) {
      // drain the stream
    }

    expect(JSON.stringify(getRequestBody(customFetch))).not.toContain('cache_control')
  })

  it.each([3, 4])('marks only the last of %i final tool results', async (resultCount) => {
    const toolCallIds = Array.from({ length: resultCount }, (_, i) => `call-${i}`)
    const toolMessages: ModelMessage[] = [
      ...messages,
      {
        role: 'assistant',
        content: toolCallIds.map((toolCallId) => ({
          type: 'tool-call' as const,
          toolCallId,
          toolName: 'search',
          input: { query: toolCallId },
        })),
      },
      {
        role: 'tool',
        content: toolCallIds.map((toolCallId) => ({
          type: 'tool-result' as const,
          toolCallId,
          toolName: 'search',
          output: { type: 'text' as const, value: `result ${toolCallId}` },
        })),
      },
    ]
    const customFetch = createStreamingFetch()
    const model = createModel('anthropic/claude-sonnet-4.5', customFetch)

    for await (const _part of model.chatStream(toolMessages, {})) {
      // drain the stream
    }

    const body = getRequestBody(customFetch)
    expect(JSON.stringify(body).match(/"cache_control"/g)).toHaveLength(3)
    expect(body.messages.filter((message) => message.role === 'tool').map((message) => message.cache_control)).toEqual([
      ...Array(resultCount - 1).fill(undefined),
      { type: 'ephemeral' },
    ])
  })
})
