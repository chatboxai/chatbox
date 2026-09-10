import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { CallChatCompletionOptions } from '@shared/models/types'
import type { ProviderModelInfo } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import { describe, expect, it, vi } from 'vitest'
import Claude from './claude'
import CustomOpenAI from './custom-openai'
import DeepSeek from './deepseek'
import OpenAI from './openai'
import OpenRouter from './openrouter'
import Ollama from './ollama'
import Qwen from './qwen'

class TestDeepSeek extends DeepSeek {
  public exposeCallSettings(options: CallChatCompletionOptions) {
    return this.getCallSettings(options)
  }
}

class TestClaude extends Claude {
  public exposeCallSettings(options: CallChatCompletionOptions) {
    return this.getCallSettings(options)
  }

  public exposeChatModel() {
    return this.getChatModel()
  }
}

class TestOpenRouter extends OpenRouter {
  public exposeCallSettings(options: CallChatCompletionOptions) {
    return this.getCallSettings(options)
  }
}

class TestQwen extends Qwen {
  public exposeCallSettings(options: CallChatCompletionOptions) {
    return this.getCallSettings(options)
  }
}

type ClaudeFetchHarness = {
  createFetch(): typeof globalThis.fetch | undefined
}

type ResolveCallSettingsHarness = {
  resolveCallSettings(options: CallChatCompletionOptions): {
    temperature?: number
    topP?: number
    maxOutputTokens?: number
    providerOptions?: unknown
  }
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

const reasoningModel = (modelId: string): ProviderModelInfo => ({
  modelId,
  type: 'chat',
  capabilities: ['reasoning'],
})

// A Qwen model id that is NOT in the hard-coded reasoning list (does not match /^qwen3/),
// so reasoning control reports it as unsupported regardless of capability metadata.
const nonReasoningQwenModel = (modelId: string): ProviderModelInfo => ({
  modelId,
  type: 'chat',
  capabilities: ['reasoning'], // capability flag is intentionally unreliable; the gate must ignore it
  providerId: 'qwen',
})

// A Qwen model id that IS in the hard-coded reasoning list (matches /^qwen3/), so reasoning
// control reports it as supported even though the registry metadata lacks the flag.
const supportedQwenModel = (modelId: string): ProviderModelInfo => ({
  modelId,
  type: 'chat',
  capabilities: [], // no 'reasoning' flag, yet reasoning control supports it by provider + id
  providerId: 'qwen',
})

describe('reasoning request options', () => {
  it('adds summarized display to Claude thinking requests before fetch', async () => {
    let requestBody: unknown
    const baseFetch: typeof globalThis.fetch = (_input, init) => {
      requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      return Promise.resolve(new Response('{}'))
    }
    const claude = new Claude(
      {
        claudeApiKey: 'test-key',
        claudeApiHost: 'https://api.anthropic.com/v1',
        model: reasoningModel('claude-sonnet-4-6'),
        customFetch: baseFetch,
      },
      createDependencies()
    )

    const wrappedFetch = (claude as unknown as ClaudeFetchHarness).createFetch()
    await wrappedFetch?.('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        thinking: {
          type: 'enabled',
          budget_tokens: 1024,
        },
      }),
    })

    expect(requestBody).toEqual({
      thinking: {
        type: 'enabled',
        budget_tokens: 1024,
        display: 'summarized',
      },
    })
  })

  it('binds the default global fetch when wrapping Claude requests', async () => {
    let fetchThis: unknown
    const globalFetch = function (this: unknown, _input: RequestInfo | URL, _init?: RequestInit) {
      fetchThis = this
      return Promise.resolve(new Response('{}'))
    } as typeof globalThis.fetch
    vi.stubGlobal('fetch', globalFetch)
    try {
      const claude = new Claude(
        {
          claudeApiKey: 'test-key',
          claudeApiHost: 'https://api.anthropic.com/v1',
          model: reasoningModel('claude-sonnet-4-6'),
        },
        createDependencies()
      )

      const wrappedFetch = (claude as unknown as ClaudeFetchHarness).createFetch()
      await wrappedFetch?.('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      expect(fetchThis).toBe(globalThis)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('converts Claude Opus 4.8 effort requests to adaptive summarized thinking before fetch', async () => {
    let requestBody: unknown
    const baseFetch: typeof globalThis.fetch = (_input, init) => {
      requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      return Promise.resolve(new Response('{}'))
    }
    const claude = new Claude(
      {
        claudeApiKey: 'test-key',
        claudeApiHost: 'https://api.anthropic.com/v1',
        model: reasoningModel('claude-opus-4-8'),
        customFetch: baseFetch,
      },
      createDependencies()
    )

    const wrappedFetch = (claude as unknown as ClaudeFetchHarness).createFetch()
    await wrappedFetch?.('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        output_config: {
          effort: 'high',
        },
      }),
    })

    expect(requestBody).toEqual({
      output_config: {
        effort: 'high',
      },
      thinking: {
        type: 'adaptive',
        display: 'summarized',
      },
    })
  })

  it('omits deprecated sampling parameters from Claude Opus 5 requests', async () => {
    let requestBody: Record<string, unknown> | undefined
    const baseFetch: typeof globalThis.fetch = (_input, init) => {
      requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      return Promise.resolve(
        new Response(
          JSON.stringify({
            type: 'message',
            id: 'msg_test',
            model: 'claude-opus-5',
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      )
    }
    const claude = new TestClaude(
      {
        claudeApiKey: 'test-key',
        claudeApiHost: 'https://api.anthropic.com/v1',
        model: reasoningModel('claude-opus-5'),
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 128,
        customFetch: baseFetch,
      },
      createDependencies()
    )
    const callSettings = claude.exposeCallSettings({})
    const request = {
      prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }],
      temperature: callSettings.temperature,
      topP: 0.9,
      topK: 5,
      maxOutputTokens: callSettings.maxOutputTokens,
      providerOptions: callSettings.providerOptions,
    } satisfies LanguageModelV3CallOptions

    expect(callSettings.temperature).toBe(0.7)
    await claude.exposeChatModel().doGenerate(request)

    expect(requestBody).toMatchObject({ model: 'claude-opus-5', max_tokens: 128 })
    expect(requestBody).not.toHaveProperty('temperature')
    expect(requestBody).not.toHaveProperty('top_p')
    expect(requestBody).not.toHaveProperty('top_k')
  })

  it('passes DeepSeek thinking toggle and official effort levels to provider options', () => {
    const deepseek = new TestDeepSeek(
      {
        apiKey: 'test-key',
        model: reasoningModel('deepseek-v4-pro'),
        temperature: 0.7,
        topP: 0.9,
      },
      createDependencies()
    )

    const defaultThinking = deepseek.exposeCallSettings({})
    const enabled = deepseek.exposeCallSettings({
      providerOptions: {
        deepseek: {
          thinking: {
            type: 'enabled',
          },
          reasoningEffort: 'max',
        },
      },
    })
    const disabled = deepseek.exposeCallSettings({
      providerOptions: {
        deepseek: {
          thinking: {
            type: 'disabled',
          },
        },
      },
    })

    expect(defaultThinking.temperature).toBeUndefined()
    expect(defaultThinking.topP).toBeUndefined()
    expect(enabled.temperature).toBeUndefined()
    expect(enabled.topP).toBeUndefined()
    expect(enabled.providerOptions).toEqual({
      deepseek: {
        thinking: {
          type: 'enabled',
        },
        reasoningEffort: 'max',
      },
    })
    expect(disabled.temperature).toBe(0.7)
    expect(disabled.topP).toBe(0.9)
    expect(disabled.providerOptions).toEqual({
      deepseek: {
        thinking: {
          type: 'disabled',
        },
      },
    })
  })

  it('passes OpenRouter reasoning effort and response inclusion options to provider options', () => {
    const openrouter = new TestOpenRouter(
      {
        apiKey: 'test-key',
        model: reasoningModel('deepseek/deepseek-v4-pro'),
      },
      createDependencies()
    )

    const settings = openrouter.exposeCallSettings({
      providerOptions: {
        openrouter: {
          reasoning: {
            effort: 'high',
            exclude: false,
          },
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      openrouter: {
        reasoning: {
          effort: 'high',
          exclude: false,
        },
      },
    })
  })

  it('keys Qwen thinking options by provider name for OpenAI-compatible extra body', () => {
    const qwen = new TestQwen(
      {
        name: 'Qwen',
        apiKey: 'test-key',
        apiHost: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: reasoningModel('qwen3.7-max'),
      },
      createDependencies()
    )

    const settings = qwen.exposeCallSettings({
      providerOptions: {
        openaiCompatible: {
          enable_thinking: true,
          thinking_budget: 8192,
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      openaiCompatible: {
        enable_thinking: true,
        thinking_budget: 8192,
      },
      Qwen: {
        enable_thinking: true,
        thinking_budget: 8192,
      },
    })
  })

  it('strips reasoning provider options when reasoning control does not support the model', () => {
    // qwen-max is not in the hard-coded reasoning list, even though the model carries a
    // (stale/unreliable) 'reasoning' capability flag. The gate must rely on provider + id.
    const qwen = new TestQwen(
      {
        name: 'Qwen',
        apiKey: 'test-key',
        apiHost: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: nonReasoningQwenModel('qwen-max'),
      },
      createDependencies()
    )

    const settings = (qwen as unknown as ResolveCallSettingsHarness).resolveCallSettings({
      providerOptions: {
        openaiCompatible: {
          enable_thinking: true,
          thinking_budget: 8192,
        },
      },
    })

    expect(settings.providerOptions).toBeUndefined()
  })

  it('keeps reasoning provider options for models supported by provider + model-id', () => {
    // qwen3.7-max matches the hard-coded reasoning list despite lacking the capability flag.
    const qwen = new TestQwen(
      {
        name: 'Qwen',
        apiKey: 'test-key',
        apiHost: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: supportedQwenModel('qwen3.7-max'),
      },
      createDependencies()
    )

    const settings = (qwen as unknown as ResolveCallSettingsHarness).resolveCallSettings({
      providerOptions: {
        openaiCompatible: {
          enable_thinking: true,
          thinking_budget: 8192,
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      openaiCompatible: {
        enable_thinking: true,
        thinking_budget: 8192,
      },
      Qwen: {
        enable_thinking: true,
        thinking_budget: 8192,
      },
    })
  })

  it('strips stale OpenAI reasoning effort for non-reasoning gpt-5-chat models', () => {
    // gpt-5-chat* are non-reasoning models; @ai-sdk/openai forwards reasoningEffort
    // as reasoning_effort unconditionally and upstream rejects it ("Unrecognized
    // request argument supplied: reasoning_effort"). The request edge must strip
    // options persisted before the capability turned off.
    const openai = new OpenAI(
      {
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com/v1',
        model: {
          modelId: 'gpt-5-chat-latest',
          type: 'chat',
          capabilities: ['reasoning'], // registry metadata is wrong for this model; the gate must ignore it
          providerId: 'openai',
        },
        dalleStyle: 'vivid',
        injectDefaultMetadata: false,
        useProxy: false,
      },
      createDependencies()
    )

    const settings = (openai as unknown as ResolveCallSettingsHarness).resolveCallSettings({
      providerOptions: {
        openai: {
          reasoningEffort: 'medium',
          forceReasoning: true,
        },
      },
    })

    expect(settings.providerOptions).toBeUndefined()
  })

  it('keeps OpenAI reasoning effort for GPT-5 reasoning models', () => {
    const openai = new OpenAI(
      {
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com/v1',
        model: {
          modelId: 'gpt-5.5',
          type: 'chat',
          capabilities: ['reasoning'],
          providerId: 'openai',
        },
        dalleStyle: 'vivid',
        injectDefaultMetadata: false,
        useProxy: false,
      },
      createDependencies()
    )

    const settings = (openai as unknown as ResolveCallSettingsHarness).resolveCallSettings({
      providerOptions: {
        openai: {
          reasoningEffort: 'medium',
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      openai: {
        reasoningEffort: 'medium',
      },
    })
  })

  it('forwards only wire-compatible reasoning options for custom OpenAI providers', () => {
    const customOpenAI = new CustomOpenAI(
      {
        apiKey: 'test-key',
        apiHost: 'https://example.com/v1',
        apiPath: '/chat/completions',
        model: {
          modelId: 'gpt-5.1',
          type: 'chat',
          apiStyle: 'openai',
          providerId: 'custom-provider-test',
        },
      },
      createDependencies()
    )

    const settings = (customOpenAI as unknown as ResolveCallSettingsHarness).resolveCallSettings({
      providerOptions: {
        openai: {
          reasoningEffort: 'high',
          forceReasoning: true,
          reasoningSummary: 'auto',
          include: ['reasoning.encrypted_content'],
        },
        openaiCompatible: {
          enable_thinking: true,
          thinking_budget: 8192,
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      openaiCompatible: { reasoningEffort: 'high' },
      'Custom OpenAI': { reasoningEffort: 'high' },
    })
  })

  it('leaves reasoning provider options untouched when the provider id is unknown', () => {
    // Defensive default: without a provider id we cannot positively classify support,
    // so options must pass through unchanged.
    const qwen = new TestQwen(
      {
        name: 'Qwen',
        apiKey: 'test-key',
        apiHost: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: { modelId: 'qwen-max', type: 'chat' },
      },
      createDependencies()
    )

    const settings = (qwen as unknown as ResolveCallSettingsHarness).resolveCallSettings({
      providerOptions: {
        openaiCompatible: {
          enable_thinking: true,
          thinking_budget: 8192,
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      openaiCompatible: {
        enable_thinking: true,
        thinking_budget: 8192,
      },
      Qwen: {
        enable_thinking: true,
        thinking_budget: 8192,
      },
    })
  })

  it('omits pinned Kimi sampling parameters at the request edge', () => {
    const openai = new OpenAI(
      {
        apiKey: 'test-key',
        apiHost: 'https://api.moonshot.cn/v1',
        model: {
          modelId: 'kimi-k3',
          type: 'chat',
          capabilities: ['reasoning', 'tool_use', 'vision'],
          providerId: 'moonshot-cn',
        },
        dalleStyle: 'vivid',
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 4096,
        injectDefaultMetadata: false,
        useProxy: false,
      },
      createDependencies()
    )

    const settings = (openai as unknown as ResolveCallSettingsHarness).resolveCallSettings({})

    expect(settings.temperature).toBeUndefined()
    expect(settings.topP).toBeUndefined()
    expect(settings.maxOutputTokens).toBe(4096)
  })

  it('keeps sampling parameters for Moonshot models that accept them', () => {
    const openai = new OpenAI(
      {
        apiKey: 'test-key',
        apiHost: 'https://api.moonshot.cn/v1',
        model: {
          modelId: 'moonshot-v1-8k',
          type: 'chat',
          providerId: 'moonshot-cn',
        },
        dalleStyle: 'vivid',
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 4096,
        injectDefaultMetadata: false,
        useProxy: false,
      },
      createDependencies()
    )

    const settings = (openai as unknown as ResolveCallSettingsHarness).resolveCallSettings({})

    expect(settings.temperature).toBe(0.7)
    expect(settings.topP).toBe(1)
    expect(settings.maxOutputTokens).toBe(4096)
  })

  it('omits pinned Kimi sampling parameters for aggregator model ids', () => {
    const openrouter = new TestOpenRouter(
      {
        apiKey: 'test-key',
        model: {
          modelId: 'moonshotai/kimi-k3',
          type: 'chat',
          capabilities: ['reasoning'],
          providerId: 'openrouter',
        },
        temperature: 0.7,
        topP: 0.9,
      },
      createDependencies()
    )

    const settings = (openrouter as unknown as ResolveCallSettingsHarness).resolveCallSettings({})

    expect(settings.temperature).toBeUndefined()
    expect(settings.topP).toBeUndefined()
  })

  it('keeps sampling parameters for locally hosted Kimi models', () => {
    const ollama = new Ollama(
      {
        ollamaHost: 'http://127.0.0.1:11434',
        model: {
          modelId: 'kimi-k2:1t',
          type: 'chat',
          providerId: 'ollama',
        },
        temperature: 0.2,
        topP: 0.8,
      },
      createDependencies()
    )

    const settings = (ollama as unknown as ResolveCallSettingsHarness).resolveCallSettings({})

    expect(settings.temperature).toBe(0.2)
    expect(settings.topP).toBe(0.8)
  })
})
