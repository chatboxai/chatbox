import type { ModelMessage } from 'ai'
import type { ModelDependencies } from 'src/shared/types/adapters'
import type { ProviderModelInfo } from 'src/shared/types/settings'
import { describe, expect, it, vi } from 'vitest'
import OpenAI from './openai'

const dependencies: ModelDependencies = {
  request: {
    apiRequest: vi.fn(),
    fetchWithOptions: vi.fn(),
  },
  storage: {
    saveImage: vi.fn(),
    getImage: vi.fn(),
  },
}

function sseResponse(events: unknown[]): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function createOpenAI(customFetch: typeof fetch, overrides: Partial<ProviderModelInfo> = {}) {
  return new OpenAI(
    {
      apiKey: 'test-api-key',
      apiHost: 'https://api.example.test',
      model: {
        modelId: 'gpt-test',
        type: 'chat',
        ...overrides,
      },
      dalleStyle: 'vivid',
      injectDefaultMetadata: true,
      useProxy: false,
      customFetch,
    },
    dependencies
  )
}

const messages: ModelMessage[] = [{ role: 'user', content: 'Hello' }]

describe('OpenAI adapter', () => {
  it('streams text through the configured endpoint with authentication', async () => {
    const customFetch = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-test',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        },
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-test',
          choices: [{ index: 0, delta: { content: 'Hello from OpenAI' }, finish_reason: null }],
        },
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-test',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 },
        },
      ])
    )
    const model = createOpenAI(customFetch)

    const chunks = []
    for await (const chunk of model.chatStream(messages, {})) chunks.push(chunk)

    expect(
      chunks
        .filter((chunk) => chunk.type === 'text-delta')
        .map((chunk) => chunk.text)
        .join('')
    ).toBe('Hello from OpenAI')
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'finish', finishReason: 'stop' }))

    const [url, init] = customFetch.mock.calls[0]
    expect(String(url)).toBe('https://api.example.test/v1/chat/completions')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-api-key')
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'gpt-test', stream: true })
  })

  it('sends image content for vision-capable models', async () => {
    const customFetch = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([
        {
          id: 'chatcmpl-vision',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-vision',
          choices: [{ index: 0, delta: { content: 'An image' }, finish_reason: 'stop' }],
        },
      ])
    )
    const model = createOpenAI(customFetch, { modelId: 'gpt-vision', capabilities: ['vision'] })
    const visionMessages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe it' },
          { type: 'image', image: new URL('https://example.test/image.png') },
        ],
      },
    ]

    for await (const _chunk of model.chatStream(visionMessages, {})) {
      // Consume the stream so the request body is produced and validated.
    }

    const request = JSON.parse(String(customFetch.mock.calls[0][1]?.body))
    expect(request.messages[0].content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'https://example.test/image.png' },
    })
  })

  it('propagates non-retryable authentication errors', async () => {
    const customFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: { message: 'Invalid API key', type: 'invalid_request_error' } }, { status: 401 })
      )
    const model = createOpenAI(customFetch)

    const consume = async () => {
      for await (const _chunk of model.chatStream(messages, {})) {
        // Consume until the provider error is surfaced.
      }
    }

    await expect(consume()).rejects.toThrow(/API Error|Invalid API key|401/)
    expect(customFetch).toHaveBeenCalledTimes(1)
  })

  it('uses configured model fallbacks when remote model listing fails', async () => {
    const fallback: ProviderModelInfo[] = [{ modelId: 'offline-model', type: 'chat' }]
    const customFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
    const model = new OpenAI(
      {
        apiKey: 'test-api-key',
        apiHost: 'https://api.example.test',
        model: { modelId: 'gpt-test', type: 'chat' },
        dalleStyle: 'vivid',
        injectDefaultMetadata: true,
        useProxy: false,
        customFetch,
        listModelsFallback: fallback,
      },
      dependencies
    )

    await expect(model.listModels()).resolves.toEqual(fallback)
  })
})
