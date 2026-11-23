import { jsonSchema, tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../models/errors'
import type { ModelDependencies } from '../../types/adapters'
import type { SentryScope } from '../../utils/sentry_adapter'
import { getProviderDefinition } from '../index'
import DotHoosh, { DOTHOOSH_API_HOST, normalizeDotHooshApiHost, normalizeDotHooshApiKey } from './models/dothoosh'

const mockScope: SentryScope = {
  setTag: vi.fn(),
  setExtra: vi.fn(),
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
      withScope: vi.fn((callback: (scope: SentryScope) => void) => callback(mockScope)),
    },
    getRemoteConfig: vi.fn(),
    platformType: 'desktop',
    oauth: {
      refreshCredential: vi.fn(),
      persistCredential: vi.fn(),
      clearCredential: vi.fn(),
    },
  }
}

const chatModel = { modelId: 'deepseek-flash', apiStyle: 'openai' as const }

function createModel(
  options: Partial<ConstructorParameters<typeof DotHoosh>[0]> = {},
  dependencies = createDependencies()
) {
  return new DotHoosh(
    {
      apiKey: 'dh_test_0123456789',
      apiHost: DOTHOOSH_API_HOST,
      model: chatModel,
      stream: true,
      ...options,
    },
    dependencies
  )
}

function sse(chunks: unknown[]): Response {
  return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('DotHoosh provider', () => {
  it('registers an OpenAI-compatible built-in provider with the live defaults', () => {
    const provider = getProviderDefinition('dothoosh')
    expect(provider).toBeDefined()
    expect(provider?.name).toBe('DotHoosh')
    expect(provider?.type).toBe('openai')
    expect(provider?.defaultSettings?.apiHost).toBe(DOTHOOSH_API_HOST)
    expect(provider?.urls).toMatchObject({
      website: 'https://gateway.dothoosh.com',
      apiKey: 'https://gateway.dothoosh.com/dashboard',
      docs: 'https://gateway.dothoosh.com/docs/quickstart',
    })
  })

  it('ships unprefixed, text-only model ids', () => {
    const models = getProviderDefinition('dothoosh')?.defaultSettings?.models || []
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      expect(model.modelId).not.toMatch(/^(openai|deepseek|anthropic|google|moonshot|dothoosh)\//)
      expect(model.capabilities || []).not.toContain('vision')
      expect(model.capabilities || []).toContain('reasoning')
    }
    expect(models.map((model) => model.modelId)).toEqual(
      expect.arrayContaining(['deepseek-flash', 'gpt-6.2-astra', 'kimi-k3.1-pro', 'gemini-3.8-flash'])
    )
  })
})

describe('DotHoosh URL normalization', () => {
  it.each([
    ['https://gateway.dothoosh.com/v1', DOTHOOSH_API_HOST],
    ['https://gateway.dothoosh.com/v1/', DOTHOOSH_API_HOST],
    ['https://gateway.dothoosh.com', DOTHOOSH_API_HOST],
    ['https://gateway.dothoosh.com/', DOTHOOSH_API_HOST],
    ['https://gateway.dothoosh.com/v1/chat/completions', DOTHOOSH_API_HOST],
    ['  https://gateway.dothoosh.com/v1  ', DOTHOOSH_API_HOST],
    ['gateway.dothoosh.com', DOTHOOSH_API_HOST],
    ['HTTPS://gateway.dothoosh.com/v1', DOTHOOSH_API_HOST],
    ['', DOTHOOSH_API_HOST],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeDotHooshApiHost(input)).toBe(expected)
  })

  it('keeps a custom proxy base on one /v1 segment', () => {
    expect(normalizeDotHooshApiHost('https://proxy.example.com/dothoosh/v1')).toBe(
      'https://proxy.example.com/dothoosh/v1'
    )
  })

  it('applies the same normalization to the model instance used for requests', () => {
    const model = createModel({ apiHost: 'https://gateway.dothoosh.com/' })
    expect(model.options.apiHost).toBe(DOTHOOSH_API_HOST)
  })
})

describe('DotHoosh API key normalization', () => {
  it.each([
    ['  dh_live_abc  ', 'dh_live_abc'],
    ['dh_live_abc\n', 'dh_live_abc'],
    ['Bearer dh_live_abc', 'dh_live_abc'],
    ['  Bearer dh_test_abc  ', 'dh_test_abc'],
    ['"dh_live_abc"', 'dh_live_abc'],
    ['', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeDotHooshApiKey(input)).toBe(expected)
  })
})

describe('DotHoosh listModels', () => {
  it('reads the live catalog fields without adding a vendor prefix', async () => {
    const dependencies = createDependencies()
    const apiRequest = vi.mocked(dependencies.request.apiRequest)
    apiRequest.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            {
              id: 'deepseek-flash',
              object: 'model',
              name: 'DeepSeek V4.1 Flash',
              context_window: 1_048_576,
              context_length: 1_048_576,
              max_output_tokens: 393_216,
              capabilities: ['prompt-caching', 'reasoning', 'streaming', 'structured-output', 'text', 'tools'],
              supported_parameters: ['reasoning', 'tools'],
              architecture: { input_modalities: ['text'], output_modalities: ['text'] },
              unknown_future_field: true,
            },
            {
              id: 'gpt-6-astra',
              name: 'GPT-6 Astra',
              context_window: 1_050_000,
              max_output_tokens: 128_000,
              capabilities: ['reasoning', 'structured-output', 'text'],
              supported_parameters: ['reasoning'],
              architecture: { input_modalities: ['text'] },
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    )

    const model = createModel({ apiKey: '  Bearer dh_test_key  ' }, dependencies)
    const models = await model.listModels()

    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://gateway.dothoosh.com/v1/models',
        method: 'GET',
      })
    )
    const listRequest = apiRequest.mock.calls[0][0]
    expect(new Headers(listRequest.headers as HeadersInit).get('authorization')).toBe('Bearer dh_test_key')
    expect(models).toEqual([
      {
        modelId: 'deepseek-flash',
        type: 'chat',
        nickname: 'DeepSeek V4.1 Flash',
        contextWindow: 1_048_576,
        maxOutput: 393_216,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'gpt-6-astra',
        type: 'chat',
        nickname: 'GPT-6 Astra',
        contextWindow: 1_050_000,
        maxOutput: 128_000,
        capabilities: ['reasoning'],
      },
    ])
  })

  it('keeps the verified defaults when the catalog request fails', async () => {
    const dependencies = createDependencies()
    const apiRequest = vi.mocked(dependencies.request.apiRequest)
    apiRequest.mockRejectedValueOnce(new Error('offline'))
    const fallback = [{ modelId: 'deepseek-flash', type: 'chat' as const }]

    const models = await createModel({ listModelsFallback: fallback }, dependencies).listModels()

    expect(models).toEqual(fallback)
  })
})

describe('DotHoosh chat requests', () => {
  it('resolves the documented endpoint, trims the key and sends no synthetic max_tokens', async () => {
    const dependencies = createDependencies()
    const apiRequest = vi.mocked(dependencies.request.apiRequest)
    apiRequest.mockResolvedValueOnce(
      sse([{ choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }] }])
    )

    const model = createModel({ apiKey: '  dh_live_key\n' }, dependencies)
    await model.chat([{ role: 'user', content: 'Hi' }], {})

    const request = apiRequest.mock.calls[0][0]
    const body = JSON.parse(String(request.body))
    expect(request.url).toBe('https://gateway.dothoosh.com/v1/chat/completions')
    expect(new Headers(request.headers as HeadersInit).get('authorization')).toBe('Bearer dh_live_key')
    expect(body.model).toBe('deepseek-flash')
    expect(body.max_tokens).toBeUndefined()
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('forwards the user output limit instead of a provider ceiling', async () => {
    const dependencies = createDependencies()
    const apiRequest = vi.mocked(dependencies.request.apiRequest)
    apiRequest.mockResolvedValueOnce(
      sse([{ choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }] }])
    )

    const model = createModel({ maxOutputTokens: 32 }, dependencies)
    await model.chat([{ role: 'user', content: 'Hi' }], {})

    expect(JSON.parse(String(apiRequest.mock.calls[0][0].body)).max_tokens).toBe(32)
  })

  it('renders reasoning_content and streamed usage', async () => {
    const dependencies = createDependencies()
    const apiRequest = vi.mocked(dependencies.request.apiRequest)
    apiRequest.mockResolvedValueOnce(
      sse([
        {
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', reasoning_content: 'Check the wallet first.' },
              finish_reason: null,
            },
          ],
        },
        { choices: [{ index: 0, delta: { content: 'Your balance covers it.' }, finish_reason: null }] },
        {
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14 },
        },
      ])
    )

    const result = await createModel({}, dependencies).chat([{ role: 'user', content: 'Can I afford it?' }], {})

    expect(result.contentParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'reasoning', text: 'Check the wallet first.' }),
        expect.objectContaining({ type: 'text', text: 'Your balance covers it.' }),
      ])
    )
    expect(result.usage).toMatchObject({ inputTokens: 5, outputTokens: 9, totalTokens: 14 })
  })

  it('keeps streamed function calls and their tool result', async () => {
    const dependencies = createDependencies()
    const apiRequest = vi.mocked(dependencies.request.apiRequest)
    apiRequest
      .mockResolvedValueOnce(
        sse([
          {
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    { index: 0, id: 'call-1', type: 'function', function: { name: 'get_balance', arguments: '' } },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index: 0, function: { arguments: '{"currency":' } }] },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index: 0, function: { arguments: '"IRR"}' } }] },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
          },
        ])
      )
      .mockResolvedValueOnce(
        sse([{ choices: [{ index: 0, delta: { content: 'Balance is 42.' }, finish_reason: 'stop' }] }])
      )

    const result = await createModel({}, dependencies).chat([{ role: 'user', content: 'Balance?' }], {
      tools: {
        get_balance: tool({
          description: 'Read the wallet balance',
          inputSchema: jsonSchema<{ currency: string }>({
            type: 'object',
            properties: { currency: { type: 'string' } },
            required: ['currency'],
          }),
          execute: async ({ currency }) => ({ currency, balance: 42 }),
        }),
      },
    })

    expect(result.contentParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'get_balance',
          args: { currency: 'IRR' },
        }),
        expect.objectContaining({ type: 'text', text: 'Balance is 42.' }),
      ])
    )
    expect(apiRequest).toHaveBeenCalledTimes(2)
  })
})

describe('DotHoosh error propagation', () => {
  it.each([
    [402, 'insufficient_available_balance'],
    [404, 'model_not_found'],
    [422, 'unsupported_capability'],
  ])('keeps HTTP %i and the error code from the OpenAI envelope', async (status, code) => {
    const dependencies = createDependencies()
    const apiRequest = vi.mocked(dependencies.request.apiRequest)
    const body = JSON.stringify({
      error: {
        type: 'invalid_request_error',
        code,
        message: 'upstream detail',
        request_id: 'req-1',
        retryable: false,
      },
    })
    apiRequest.mockResolvedValueOnce(new Response(body, { status, headers: { 'content-type': 'application/json' } }))

    const error = await createModel({}, dependencies)
      .chat([{ role: 'user', content: 'Hi' }], {})
      .then(
        () => undefined,
        (caught: unknown) => caught
      )

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ statusCode: status, responseBody: body })
  })

  it('rethrows a transport ApiError unchanged', async () => {
    const dependencies = createDependencies()
    const body = JSON.stringify({ error: { code: 'api_key_invalid' } })
    vi.mocked(dependencies.request.apiRequest).mockRejectedValueOnce(new ApiError('Status Code 401', body, 401))

    await expect(createModel({}, dependencies).chat([{ role: 'user', content: 'Hi' }], {})).rejects.toMatchObject({
      statusCode: 401,
      responseBody: body,
    })
  })
})
