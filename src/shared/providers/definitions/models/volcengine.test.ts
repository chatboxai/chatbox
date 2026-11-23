import type { EmbeddingModelV4, LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider'
import type { CallChatCompletionOptions } from '@shared/models/types'
import type { ProviderModelInfo } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VolcEngine from './volcengine'

class TestVolcEngine extends VolcEngine {
  public exposeChatModel() {
    return this.getChatModel()
  }

  public exposeEmbeddingModel() {
    return this.getTextEmbeddingModel({})
  }

  public exposeCallSettings(options: CallChatCompletionOptions) {
    return this.getCallSettings(options)
  }
}

const chatRequest: LanguageModelV4CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
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

function createModel(model: ProviderModelInfo) {
  return new TestVolcEngine(
    {
      apiKey: 'test-api-key',
      model,
    },
    createDependencies()
  )
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function requestBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') return undefined
  return JSON.parse(init.body) as unknown
}

describe('VolcEngine request routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends text embeddings to the Ark embeddings endpoint', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: requestUrl(input), body: requestBody(init) })
        return new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2] }],
            usage: { prompt_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      })
    )

    const embeddingModel = createModel({
      modelId: 'doubao-embedding-text-240715',
      type: 'embedding',
    }).exposeEmbeddingModel()
    expect(embeddingModel).toBeTruthy()
    await (embeddingModel as EmbeddingModelV4).doEmbed({ values: ['alpha', 'beta'] })

    expect(requests).toEqual([
      {
        url: 'https://ark.cn-beijing.volces.com/api/v3/embeddings',
        body: {
          model: 'doubao-embedding-text-240715',
          input: ['alpha', 'beta'],
          encoding_format: 'float',
        },
      },
    ])
  })

  it('sends vision embedding models to the multimodal endpoint once per text', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: requestUrl(input), body: requestBody(init) })
        return new Response(JSON.stringify({ data: { embedding: [0.3, 0.4] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })
    )

    const embeddingModel = createModel({
      modelId: 'doubao-embedding-vision-251215',
      type: 'embedding',
    }).exposeEmbeddingModel()
    const result = await (embeddingModel as EmbeddingModelV4).doEmbed({ values: ['alpha', 'beta'] })

    expect(requests).toEqual([
      {
        url: 'https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal',
        body: {
          model: 'doubao-embedding-vision-251215',
          input: [{ type: 'text', text: 'alpha' }],
        },
      },
      {
        url: 'https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal',
        body: {
          model: 'doubao-embedding-vision-251215',
          input: [{ type: 'text', text: 'beta' }],
        },
      },
    ])
    expect(result.embeddings).toEqual([
      [0.3, 0.4],
      [0.3, 0.4],
    ])
  })

  it('keeps chat requests on the chat completions endpoint', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: requestUrl(input), body: requestBody(init) })
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      })
    )

    const chatModel = createModel({ modelId: 'doubao-seed-2-1-pro-260628' }).exposeChatModel() as LanguageModelV4
    await chatModel.doGenerate(chatRequest)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions')
    expect(requests[0]?.body).toMatchObject({
      model: 'doubao-seed-2-1-pro-260628',
    })
  })

  it('sends Ark thinking controls for deepseek-v4-flash-ga-260731', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: requestUrl(input), body: requestBody(init) })
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: 'assistant', content: '2', reasoning_content: '1+1=2' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      })
    )

    const model = new TestVolcEngine(
      {
        apiKey: 'test-api-key',
        model: {
          modelId: 'deepseek-v4-flash-ga-260731',
          capabilities: ['reasoning', 'tool_use'],
        },
        temperature: 0.7,
        topP: 0.9,
      },
      createDependencies()
    )
    const callSettings = model.exposeCallSettings({
      providerOptions: {
        deepseek: {
          thinking: { type: 'enabled' },
          reasoningEffort: 'low',
        },
      },
    })
    const chatModel = model.exposeChatModel() as LanguageModelV4
    await chatModel.doGenerate({
      ...chatRequest,
      temperature: callSettings.temperature,
      topP: callSettings.topP,
      maxOutputTokens: callSettings.maxOutputTokens,
      providerOptions: callSettings.providerOptions,
    })

    expect(callSettings.temperature).toBeUndefined()
    expect(callSettings.topP).toBeUndefined()
    expect(requests[0]?.body).toMatchObject({
      model: 'deepseek-v4-flash-ga-260731',
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    })
    expect(requests[0]?.body).not.toHaveProperty('temperature')
    expect(requests[0]?.body).not.toHaveProperty('top_p')
  })

  it('recognizes DeepSeek model ids as reasoning models without a capability flag', () => {
    expect(createModel({ modelId: 'deepseek-v4-flash-ga-260731' }).isSupportReasoning()).toBe(true)
    expect(
      createModel({ modelId: 'doubao-seed-2-1-pro-260628', capabilities: ['reasoning'] }).isSupportReasoning()
    ).toBe(true)
    expect(createModel({ modelId: 'doubao-embedding-text-240715' }).isSupportReasoning()).toBe(false)
  })

  it('sends empty reasoning_content on DeepSeek V4 assistant history', async () => {
    const requests: Array<{ body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ body: requestBody(init) })
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      })
    )

    const chatModel = createModel({ modelId: 'deepseek-v4-flash-ga-260731' }).exposeChatModel() as LanguageModelV4
    await chatModel.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
        { role: 'user', content: [{ type: 'text', text: 'Again' }] },
      ],
    })

    expect(requests[0]?.body).toMatchObject({
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello', reasoning_content: '' },
        { role: 'user', content: 'Again' },
      ],
    })
  })

  it('keeps existing DeepSeek V4 reasoning content and leaves older models unchanged', async () => {
    const requests: Array<{ body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ body: requestBody(init) })
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      })
    )

    const withReasoning: LanguageModelV4CallOptions['prompt'] = [
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thought' },
          { type: 'text', text: 'Hello' },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'Again' }] },
    ]
    const withoutReasoning: LanguageModelV4CallOptions['prompt'] = [
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      { role: 'user', content: [{ type: 'text', text: 'Again' }] },
    ]
    await (createModel({ modelId: 'deepseek-v4-flash-ga-260731' }).exposeChatModel() as LanguageModelV4).doGenerate({
      prompt: withReasoning,
    })
    await (createModel({ modelId: 'deepseek-r1-250528' }).exposeChatModel() as LanguageModelV4).doGenerate({
      prompt: withoutReasoning,
    })

    expect(requests[0]?.body).toMatchObject({
      messages: [{}, { role: 'assistant', reasoning_content: 'thought' }, {}],
    })
    const olderMessages = (requests[1]?.body as { messages?: Array<Record<string, unknown>> }).messages
    expect(olderMessages?.[1]).not.toHaveProperty('reasoning_content')
  })
})
