import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'
import { settings as getDefaultSettings, newConfigs } from '../../defaults'
import type { CallChatCompletionOptions, ModelInterface } from '../../models/types'
import { getModel } from '../../providers'
import { convertToModelMessages } from '../../services/model-message-converter'
import type { SessionSettings, Settings } from '../../types'
import { ModelProviderEnum } from '../../types'
import type { ModelDependencies } from '../../types/adapters'
import { getReasoningProviderOptions, resolveReasoningReplayPolicy } from '../../utils/reasoning-control'
import type { SentryScope } from '../../utils/sentry_adapter'
import CustomClaude from './models/custom-claude'
import CustomGemini from './models/custom-gemini'
import OpenAI from './models/openai'
import OpenAIResponses from './models/openai-responses'
import { OPENCODE_GO_API_HOST } from './opencode-go'
import {
  buildOpenCodeSessionHeaders,
  mergeOpenCodeSessionHeaders,
  OPENCODE_SESSION_HEADER,
  resolveOpenCodeSessionId,
} from './opencode-shared'
import { OPENCODE_ZEN_API_HOST } from './opencode-zen'

const mockScope: SentryScope = {
  setTag: vi.fn(),
  setExtra: vi.fn(),
}

function createDependencies(): ModelDependencies {
  return {
    request: {
      fetchWithOptions: vi.fn(),
      apiRequest: vi.fn(),
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

function createModel(
  provider: ModelProviderEnum.OpenCodeGo | ModelProviderEnum.OpenCodeZen,
  modelId: string,
  dependencies: ModelDependencies = createDependencies(),
  useProxy?: boolean
) {
  const sessionSettings: SessionSettings = {
    provider,
    modelId,
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stream: true,
  }
  const defaultSettings = getDefaultSettings()
  const apiHost = provider === ModelProviderEnum.OpenCodeGo ? OPENCODE_GO_API_HOST : OPENCODE_ZEN_API_HOST
  const globalSettings: Settings = {
    ...defaultSettings,
    providers: {
      ...defaultSettings.providers,
      [provider]: {
        apiKey: 'sk-test',
        apiHost,
        useProxy,
        models: [{ modelId }],
      },
    },
  }
  return getModel(sessionSettings, globalSettings, newConfigs(), dependencies)
}

function exposeRequestHeaders(model: ModelInterface, options?: CallChatCompletionOptions) {
  return (
    model as unknown as { getRequestHeaders(options?: CallChatCompletionOptions): Record<string, string> }
  ).getRequestHeaders(options)
}

function exposeChatModel(model: ModelInterface, options?: CallChatCompletionOptions): LanguageModelV4 {
  return (model as unknown as { getChatModel(options?: CallChatCompletionOptions): LanguageModelV4 }).getChatModel(
    options
  )
}

function headerValue(headers: Record<string, string> | undefined, name: string) {
  if (!headers) return undefined
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return match?.[1]
}

const generateRequest: LanguageModelV4CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
}

function jsonReply(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })
}

function chatCompletionsReply() {
  return jsonReply({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'glm-5.3',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
}

function responsesApiReply() {
  return jsonReply({
    id: 'resp_test',
    object: 'response',
    created_at: 0,
    status: 'completed',
    model: 'grok-4.5',
    output: [
      {
        id: 'msg_test',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello', annotations: [] }],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  })
}

describe('OpenCode session header helpers', () => {
  it('keeps a Chatbox conversation id unchanged', () => {
    expect(resolveOpenCodeSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    )
  })

  it('uses a stable fallback when the conversation id is missing', () => {
    expect(resolveOpenCodeSessionId()).toBe('chatbox')
    expect(resolveOpenCodeSessionId('   ')).toBe('chatbox')
  })

  it('sanitizes and clamps unsafe conversation ids', () => {
    expect(resolveOpenCodeSessionId('sess id/with spaces')).toBe('sess-id-with-spaces')
    expect(resolveOpenCodeSessionId('a'.repeat(200))).toHaveLength(128)
  })

  it('always emits x-opencode-session', () => {
    expect(buildOpenCodeSessionHeaders('session-1')).toEqual({
      [OPENCODE_SESSION_HEADER]: 'session-1',
    })
    expect(mergeOpenCodeSessionHeaders({ 'X-Title': 'Chatbox AI' }, 'session-2')).toEqual({
      'X-Title': 'Chatbox AI',
      [OPENCODE_SESSION_HEADER]: 'session-2',
    })
  })
})

describe('OpenCode request session headers', () => {
  it.each([
    [ModelProviderEnum.OpenCodeGo, 'glm-5.3', OpenAI],
    [ModelProviderEnum.OpenCodeGo, 'grok-4.5', OpenAIResponses],
    [ModelProviderEnum.OpenCodeGo, 'minimax-m3', CustomClaude],
    [ModelProviderEnum.OpenCodeZen, 'gemini-3.7-flash', CustomGemini],
  ] as const)('stamps a per-conversation header on %s %s', (provider, modelId, ModelClass) => {
    const model = createModel(provider, modelId)
    expect(model).toBeInstanceOf(ModelClass)
    expect(exposeRequestHeaders(model, { sessionId: 'conversation-a' })).toEqual(
      expect.objectContaining({ [OPENCODE_SESSION_HEADER]: 'conversation-a' })
    )
    expect(exposeRequestHeaders(model, { sessionId: 'conversation-b' })[OPENCODE_SESSION_HEADER]).toBe('conversation-b')
    expect(exposeRequestHeaders(model, {})[OPENCODE_SESSION_HEADER]).toBe('chatbox')
  })

  it('keeps the Anthropic browser-access header on MiniMax/Qwen', () => {
    const headers = exposeRequestHeaders(createModel(ModelProviderEnum.OpenCodeGo, 'qwen3.8-max'), {
      sessionId: 'session-claude',
    })
    expect(headers).toEqual(
      expect.objectContaining({
        'anthropic-dangerous-direct-browser-access': 'true',
        [OPENCODE_SESSION_HEADER]: 'session-claude',
      })
    )
  })

  it('posts Chat Completions with x-opencode-session', async () => {
    const dependencies = createDependencies()
    const apiRequest = vi.mocked(dependencies.request.apiRequest)
    apiRequest.mockResolvedValueOnce(chatCompletionsReply())

    const model = createModel(ModelProviderEnum.OpenCodeGo, 'glm-5.3', dependencies)
    await exposeChatModel(model, { sessionId: 'session-chat' }).doGenerate(generateRequest)

    expect(headerValue(apiRequest.mock.calls[0]?.[0]?.headers as Record<string, string>, OPENCODE_SESSION_HEADER)).toBe(
      'session-chat'
    )
  })

  it('posts Responses with x-opencode-session', async () => {
    const dependencies = createDependencies()
    const apiRequest = vi.mocked(dependencies.request.apiRequest)
    apiRequest.mockResolvedValueOnce(responsesApiReply())

    const model = createModel(ModelProviderEnum.OpenCodeGo, 'grok-4.5', dependencies)
    await exposeChatModel(model, { sessionId: 'session-responses' }).doGenerate(generateRequest)

    expect(headerValue(apiRequest.mock.calls[0]?.[0]?.headers as Record<string, string>, OPENCODE_SESSION_HEADER)).toBe(
      'session-responses'
    )
  })
})

const deepseekModel = { modelId: 'deepseek-v4-pro', apiStyle: 'openai' as const }

function deepseekReply(stream: boolean) {
  if (!stream) {
    return jsonReply({
      id: 'chatcmpl-deepseek',
      object: 'chat.completion',
      created: 0,
      model: deepseekModel.modelId,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '42', reasoning_content: 'Let me calculate.' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    })
  }
  const chunks = [
    {
      choices: [
        { index: 0, delta: { role: 'assistant', reasoning_content: 'Let me calculate.' }, finish_reason: null },
      ],
    },
    { choices: [{ index: 0, delta: { content: '42' }, finish_reason: null }] },
    {
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    },
  ]
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
      'data: [DONE]\n\ndata: {"invalid":"trailing gateway data"}\n\n',
    {
      headers: { 'content-type': 'text/event-stream' },
    }
  )
}

describe.each([ModelProviderEnum.OpenCodeGo, ModelProviderEnum.OpenCodeZen] as const)(
  '%s DeepSeek protocol',
  (provider) => {
    it.each([
      ['default', undefined, undefined],
      ['off', 'disabled', undefined],
      ['low', 'enabled', 'low'],
      ['medium', 'enabled', 'high'],
      ['high', 'enabled', 'max'],
    ] as const)(
      'serializes the %s reasoning control and preserves streamed reasoning',
      async (level, thinking, effort) => {
        const dependencies = createDependencies()
        const apiRequest = vi.mocked(dependencies.request.apiRequest)
        apiRequest.mockResolvedValueOnce(deepseekReply(true))
        const model = createModel(provider, deepseekModel.modelId, dependencies)
        const result = await model.chat([{ role: 'user', content: 'Calculate.' }], {
          sessionId: 'deepseek-session',
          providerOptions: getReasoningProviderOptions(provider, deepseekModel, level),
        })
        const request = apiRequest.mock.calls[0][0]
        const body = JSON.parse(String(request.body))
        expect(body.thinking).toEqual(thinking ? { type: thinking } : undefined)
        expect(body.reasoning_effort).toBe(effort)
        expect(body.stream).toBe(true)
        expect(body.temperature).toBe(0.7)
        expect(body.top_p).toBe(0.9)
        expect(request.url).toBe(
          `${provider === ModelProviderEnum.OpenCodeGo ? OPENCODE_GO_API_HOST : OPENCODE_ZEN_API_HOST}/chat/completions`
        )
        expect(headerValue(request.headers as Record<string, string>, OPENCODE_SESSION_HEADER)).toBe('deepseek-session')
        expect(result.contentParts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'reasoning', text: 'Let me calculate.' }),
            expect.objectContaining({ type: 'text', text: '42' }),
          ])
        )
      }
    )

    it('preserves non-streaming reasoning and tool continuation history through the proxy', async () => {
      const dependencies = createDependencies()
      const apiRequest = vi.mocked(dependencies.request.apiRequest)
      apiRequest.mockResolvedValueOnce(deepseekReply(false))
      const model = createModel(provider, deepseekModel.modelId, dependencies)
      expect(model).toBeInstanceOf(OpenAI)
      if (!(model instanceof OpenAI)) throw new Error('Expected OpenCode Chat model')
      model.options.stream = false
      model.options.useProxy = true
      const messages = await convertToModelMessages(
        [
          { id: 'user-1', role: 'user', contentParts: [{ type: 'text', text: 'Calculate.' }] },
          {
            id: 'assistant-1',
            role: 'assistant',
            contentParts: [
              { type: 'reasoning', text: 'Use the calculator.' },
              {
                type: 'tool-call',
                state: 'result',
                toolCallId: 'call-1',
                toolName: 'calculate',
                args: { expression: '6*7' },
                result: 42,
              },
            ],
          },
        ],
        async () => null,
        { modelSupportVision: false, ...resolveReasoningReplayPolicy(provider, deepseekModel) }
      )
      const result = await model.chat(messages, {
        providerOptions: getReasoningProviderOptions(provider, deepseekModel, 'high'),
      })
      const request = apiRequest.mock.calls[0][0]
      const body = JSON.parse(String(request.body))
      expect(body.stream).not.toBe(true)
      expect(request.useProxy).toBe(true)
      expect(request.retry).toBe(0)
      expect(body.messages[1]).toMatchObject({
        role: 'assistant',
        reasoning_content: 'Use the calculator.',
        tool_calls: [{ id: 'call-1', function: { name: 'calculate', arguments: '{"expression":"6*7"}' } }],
      })
      expect(body.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'call-1', content: '42' })
      expect(result.contentParts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'reasoning', text: 'Let me calculate.' }),
          expect.objectContaining({ type: 'text', text: '42' }),
        ])
      )
    })

    it('keeps custom fetch and extra headers for DeepSeek', async () => {
      const model = createModel(provider, deepseekModel.modelId)
      if (!(model instanceof OpenAI)) throw new Error('Expected OpenCode Chat model')
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(deepseekReply(false))
      model.options.customFetch = fetch
      model.options.extraHeaders = { 'x-custom': 'test-header' }
      await exposeChatModel(model, { sessionId: 'custom-session' }).doGenerate(generateRequest)
      const headers = new Headers(fetch.mock.calls[0][1]?.headers)
      expect(headers.get('x-custom')).toBe('test-header')
      expect(headers.get(OPENCODE_SESSION_HEADER)).toBe('custom-session')
    })

    it('keeps ordinary Chat Completions models and excludes stale DeepSeek settings', async () => {
      const dependencies = createDependencies()
      const apiRequest = vi.mocked(dependencies.request.apiRequest)
      apiRequest.mockResolvedValueOnce(chatCompletionsReply())
      const model = createModel(provider, 'glm-5.3', dependencies)
      if (!(model instanceof OpenAI)) throw new Error('Expected OpenCode Chat model')
      model.options.stream = false
      const result = await model.chat([{ role: 'user', content: 'Hi' }], {
        providerOptions: { deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'max' } },
      })
      const body = JSON.parse(String(apiRequest.mock.calls[0][0].body))
      expect(body.thinking).toBeUndefined()
      expect(body.reasoning_effort).toBeUndefined()
      expect(result.contentParts).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Hello' })])
      )
    })
  }
)

describe('OpenCode network compatibility', () => {
  const routes = [
    [ModelProviderEnum.OpenCodeGo, 'glm-5.3'],
    [ModelProviderEnum.OpenCodeGo, 'deepseek-v4-pro'],
    [ModelProviderEnum.OpenCodeZen, 'deepseek-v4-pro'],
    [ModelProviderEnum.OpenCodeGo, 'grok-4.5'],
    [ModelProviderEnum.OpenCodeGo, 'minimax-m3'],
    [ModelProviderEnum.OpenCodeZen, 'glm-5.3'],
    [ModelProviderEnum.OpenCodeZen, 'grok-4.5'],
    [ModelProviderEnum.OpenCodeZen, 'claude-sonnet-4-6'],
    [ModelProviderEnum.OpenCodeZen, 'gemini-3.7-flash'],
  ] as const

  it.each(routes)('uses native mobile transport for %s %s streams and catalogs', async (provider, modelId) => {
    for (const useProxy of [undefined, false, true]) {
      const dependencies = createDependencies()
      dependencies.platformType = 'mobile'
      const request = vi.mocked(dependencies.request.apiRequest)
      request.mockResolvedValueOnce(new Response('', { headers: { 'content-type': 'text/event-stream' } }))
      const model = createModel(provider, modelId, dependencies, useProxy)
      const controller = new AbortController()
      const result = await exposeChatModel(model).doStream({ ...generateRequest, abortSignal: controller.signal })
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          useProxy: true,
          signal: controller.signal,
          retry: 0,
        })
      )
      await result.stream.cancel()
      request.mockClear()
      request.mockResolvedValueOnce(jsonReply({ data: [{ id: modelId }] }))
      await (model as OpenAI).listModels()
      expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', useProxy: true }))
    }
  })

  it.each(['desktop', 'web'] as const)('resolves the %s transport independently of mobile defaults', (platformType) => {
    for (const [provider, modelId] of routes) {
      for (const useProxy of [undefined, false, true]) {
        const dependencies = createDependencies()
        dependencies.platformType = platformType
        const model = createModel(provider, modelId, dependencies, useProxy)
        expect((model as OpenAI).options.useProxy).toBe(useProxy ?? false)
      }
    }
  })
})
