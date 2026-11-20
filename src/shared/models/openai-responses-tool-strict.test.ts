import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { jsonSchema, tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { settings as getDefaultSettings, newConfigs } from '../defaults'
import { getModel } from '../providers'
import { ModelProviderEnum, ModelProviderType, type ProviderSettings, type Settings } from '../types'
import type { ModelDependencies } from '../types/adapters'
import type { SentryScope } from '../utils/sentry_adapter'
import { openAIResponsesToolStrictMiddleware } from './openai-responses-tool-strict'

type CallTools = NonNullable<LanguageModelV4CallOptions['tools']>

const inputSchema = { type: 'object' as const, properties: { q: { type: 'string' as const } } }

function transform(params: LanguageModelV4CallOptions) {
  const transformParams = openAIResponsesToolStrictMiddleware.transformParams
  if (!transformParams) throw new Error('transformParams is not defined')
  return transformParams({ type: 'stream', params, model: {} as LanguageModelV4 })
}

describe('openAIResponsesToolStrictMiddleware', () => {
  it('defaults only function tools without strict to strict=false', async () => {
    const tools: CallTools = [
      { type: 'function', name: 'unspecified', inputSchema },
      { type: 'function', name: 'strict', inputSchema, strict: true },
      { type: 'function', name: 'loose', inputSchema, strict: false },
      { type: 'provider', id: 'openai.web_search', name: 'web_search', args: {} },
    ]
    const params: LanguageModelV4CallOptions = { prompt: [], tools }
    const snapshot = structuredClone(params)

    const result = await transform(params)

    expect(result.tools).toEqual([
      { type: 'function', name: 'unspecified', inputSchema, strict: false },
      { type: 'function', name: 'strict', inputSchema, strict: true },
      { type: 'function', name: 'loose', inputSchema, strict: false },
      { type: 'provider', id: 'openai.web_search', name: 'web_search', args: {} },
    ])
    expect(result.tools?.[3]).toBe(tools[3])
    expect(params).toEqual(snapshot)
  })

  it('returns params unchanged when no tool needs a default', async () => {
    const withoutTools: LanguageModelV4CallOptions = { prompt: [] }
    const explicitTools: LanguageModelV4CallOptions = {
      prompt: [],
      tools: [{ type: 'function', name: 'strict', inputSchema, strict: true }],
    }

    expect(await transform(withoutTools)).toBe(withoutTools)
    expect(await transform(explicitTools)).toBe(explicitTools)
  })
})

const responsesReply =
  'data: {"type":"response.completed","response":{"id":"resp_1","created_at":1,"model":"test","status":"completed","incomplete_details":null,"output":[],"usage":{"input_tokens":1,"output_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}}}}\n\n'

const chatCompletionsReply =
  'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'

function createDependencies(reply: string): ModelDependencies {
  return {
    request: {
      apiRequest: vi.fn(async () => new Response(reply, { headers: { 'content-type': 'text/event-stream' } })),
      fetchWithOptions: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn((callback: (scope: SentryScope) => void) => callback({ setTag: vi.fn(), setExtra: vi.fn() })),
    },
    getRemoteConfig: vi.fn(() => ({})),
    platformType: 'desktop',
  }
}

async function sendToolRequest(provider: string, modelId: string, reply: string, providerSettings: ProviderSettings) {
  const dependencies = createDependencies(reply)
  const defaultSettings = getDefaultSettings()
  const settings: Settings = {
    ...defaultSettings,
    providers: {
      ...defaultSettings.providers,
      [provider]: { apiKey: 'test-key', ...providerSettings, models: [{ modelId }] },
    },
    customProviders: [
      { id: 'custom-responses', name: 'Custom Responses', type: ModelProviderType.OpenAIResponses, isCustom: true },
    ],
  }
  const model = getModel({ provider, modelId, stream: true }, settings, newConfigs(), dependencies)
  const tools = { search: tool({ description: 'Search', inputSchema: jsonSchema(inputSchema) }) }

  for await (const _part of model.chatStream([{ role: 'user', content: 'Hi' }], { tools })) {
    // Drain the stream so the request is sent.
  }

  const request = vi.mocked(dependencies.request.apiRequest).mock.calls[0]?.[0]
  const body = JSON.parse(String(request?.body)) as { tools?: Record<string, unknown>[] }
  return { apiStyle: model.apiStyle, tools: body.tools }
}

describe('Responses tool strict default at the model boundary', () => {
  it.each([
    ['OpenAI Responses API key', ModelProviderEnum.OpenAIResponses, 'gpt-5.4', { apiHost: 'https://api.openai.com' }],
    ['custom OpenAI Responses provider', 'custom-responses', 'gpt-5.4', { apiHost: 'https://gateway.example/v1' }],
    ['GitHub Copilot Responses model', 'github-copilot', 'gpt-5.6-luna', { apiHost: 'https://api.githubcopilot.com' }],
    ['OpenCode Go Responses model', ModelProviderEnum.OpenCodeGo, 'gpt-5.6-luna', {}],
  ])('sends strict=false for %s', async (_name, provider, modelId, providerSettings) => {
    const { apiStyle, tools } = await sendToolRequest(provider, modelId, responsesReply, providerSettings)

    expect(apiStyle).toBe('openai-responses')
    expect(tools).toEqual([expect.objectContaining({ type: 'function', name: 'search', strict: false })])
  })

  it('leaves Chat Completions tools without a strict field', async () => {
    const { apiStyle, tools } = await sendToolRequest(ModelProviderEnum.OpenAI, 'gpt-4o', chatCompletionsReply, {
      apiHost: 'https://api.openai.com',
    })

    expect(apiStyle).toBe('openai')
    expect(tools).toHaveLength(1)
    expect(tools?.[0]).not.toHaveProperty('strict')
    expect(tools?.[0]?.function).not.toHaveProperty('strict')
  })
})
