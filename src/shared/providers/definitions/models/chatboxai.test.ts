import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { CallSettings } from '@shared/models/abstract-ai-sdk'
import type { CallChatCompletionOptions } from '@shared/models/types'
import { type ChatboxAILicenseDetail, type ProviderModelInfo, ProviderModelInfoSchema } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatboxAI from './chatboxai'

const openAIMocks = vi.hoisted(() => {
  const languageModel: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'openai',
    modelId: 'gpt-5-mini',
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  }

  const responses = vi.fn(() => languageModel)
  const createOpenAI = vi.fn(() => ({
    responses,
    languageModel: vi.fn(),
  }))

  return {
    createOpenAI,
    responses,
  }
})

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: openAIMocks.createOpenAI,
}))

class TestChatboxAI extends ChatboxAI {
  public exposeCallSettings(options: CallChatCompletionOptions): CallSettings {
    return this.getCallSettings(options)
  }

  public exposeProvider(options: CallChatCompletionOptions) {
    return this.getProvider(options)
  }

  public exposeChatModel(options: CallChatCompletionOptions) {
    return this.getChatModel(options)
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

function createModel(
  model: ProviderModelInfo,
  overrides: { maxOutputTokens?: number; temperature?: number; topP?: number } = {}
) {
  return new TestChatboxAI(
    {
      licenseKey: 'test-license',
      licenseInstances: {
        'test-license': 'test-instance',
      },
      licenseDetail: {} as ChatboxAILicenseDetail,
      model,
      language: 'en',
      dalleStyle: 'vivid',
      maxOutputTokens: overrides.maxOutputTokens,
      temperature: overrides.temperature,
      topP: overrides.topP,
    },
    { uuid: 'test-uuid' },
    createDependencies()
  )
}

describe('ChatboxAI apiStyle fallback', () => {
  it('infers google apiStyle for cached Gemini models without apiStyle metadata', () => {
    const model = createModel({
      modelId: 'gemini-3.5-flash',
      type: 'chat',
    })

    expect(model.options.model.apiStyle).toBe('google')
  })

  it('infers anthropic apiStyle for cached Claude models without apiStyle metadata', () => {
    const model = createModel({
      modelId: 'claude-sonnet-5',
      type: 'chat',
    })

    expect(model.options.model.apiStyle).toBe('anthropic')
  })

  it('preserves explicit apiStyle even when the model id has a known prefix', () => {
    const model = createModel({
      modelId: 'claude-compatible-via-openai',
      type: 'chat',
      apiStyle: 'openai',
    })

    expect(model.options.model.apiStyle).toBe('openai')
  })
})

describe('ChatboxAI Gemini thinking options', () => {
  it.each([
    ['gemini-3.7-flash', false],
    ['gemini-3.7-flash', true],
    ['gemini-3.8-flash', false],
    ['gemini-3.8-flash', true],
    ['gemini-3.9-flash', false],
    ['gemini-3.9-flash', true],
    ['gemini-3.9-flash-lite', false],
    ['gemini-3-pro-preview', false],
  ] as const)('normalizes %s saved minimal with includeThoughts=%s', (modelId, includeThoughts) => {
    const model = createModel({ modelId, apiStyle: 'google' })
    const thinkingConfig = { thinkingLevel: 'minimal' as const, includeThoughts }
    const settings = model.exposeCallSettings({ providerOptions: { google: { thinkingConfig } } })

    expect(settings.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'low', includeThoughts } },
    })
    expect(thinkingConfig).toEqual({ thinkingLevel: 'minimal', includeThoughts })
  })

  it.each(['low', 'medium', 'high'] as const)('preserves supported level %s', (thinkingLevel) => {
    const model = createModel({ modelId: 'gemini-3.8-flash', apiStyle: 'google' })
    const settings = model.exposeCallSettings({
      providerOptions: { google: { thinkingConfig: { thinkingLevel, includeThoughts: true } } },
    })

    expect(settings.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingLevel, includeThoughts: true } },
    })
  })

  it('leaves absent thinking levels for the gateway to default', () => {
    const model = createModel({ modelId: 'gemini-3.8-flash', apiStyle: 'google' })

    expect(model.exposeCallSettings({}).providerOptions).toBeUndefined()
    expect(
      model.exposeCallSettings({ providerOptions: { google: { thinkingConfig: { includeThoughts: false } } } })
        .providerOptions
    ).toEqual({ google: { thinkingConfig: { includeThoughts: false } } })
  })

  it.each([
    'gemini-3-flash-preview',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-3.1-flash-lite-preview',
    'gemini-3.5-flash-lite',
  ])('preserves minimal for %s', (modelId) => {
    const model = createModel({ modelId, apiStyle: 'google' })
    const settings = model.exposeCallSettings({
      providerOptions: { google: { thinkingConfig: { thinkingLevel: 'minimal', includeThoughts: false } } },
    })

    expect(settings.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'minimal', includeThoughts: false } },
    })
  })
})

describe('ChatboxAI openai-responses models', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults chat models without capability metadata to tool-use capable', () => {
    const model = createModel({
      modelId: 'gpt-5.5',
      type: 'chat',
      apiStyle: 'openai-responses',
    })

    expect(model.isSupportToolUse('agent')).toBe(true)
  })

  it('respects explicit capability metadata when provided', () => {
    const model = createModel({
      modelId: 'gpt-5.5',
      type: 'chat',
      apiStyle: 'openai-responses',
      capabilities: [],
    })

    expect(model.isSupportToolUse('agent')).toBe(false)
  })

  it('keeps weak DeepSeek tool-use models disabled for scoped tools even without capability metadata', () => {
    const model = createModel({
      modelId: 'deepseek-chat',
      type: 'chat',
      apiStyle: 'openai',
    })

    expect(model.isSupportToolUse('agent')).toBe(false)
    expect(model.isSupportToolUse('read-file')).toBe(false)
  })

  it('accepts openai-responses as a provider model apiStyle', () => {
    const parsed = ProviderModelInfoSchema.parse({
      modelId: 'gpt-5-mini',
      type: 'chat',
      apiStyle: 'openai-responses',
      capabilities: ['reasoning', 'tool_use'],
    })

    expect(parsed.apiStyle).toBe('openai-responses')
  })

  it('creates an OpenAI Responses gateway provider with Chatbox AI auth headers', () => {
    const model = createModel({
      modelId: 'gpt-5-mini',
      type: 'chat',
      apiStyle: 'openai-responses',
      capabilities: ['reasoning', 'tool_use'],
    })

    model.exposeProvider({ sessionId: 'session-123', agentMode: true })

    expect(openAIMocks.createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-license',
        baseURL: expect.stringContaining('/gateway/openai-responses/v1'),
        headers: {
          'Instance-Id': 'test-instance',
          'chatbox-session-id': 'session-123',
          'chatbox-agent-mode': 'true',
        },
        fetch: expect.any(Function),
      })
    )
  })

  it('marks normal Chatbox AI requests as outside agent mode', () => {
    const model = createModel({
      modelId: 'gpt-5-mini',
      type: 'chat',
      apiStyle: 'openai-responses',
      capabilities: ['reasoning', 'tool_use'],
    })

    model.exposeProvider({ sessionId: 'session-123' })

    expect(openAIMocks.createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'chatbox-agent-mode': 'false',
        }),
      })
    )
  })

  it('uses provider.responses for openai-responses chat models', () => {
    const model = createModel({
      modelId: 'gpt-5-mini',
      type: 'chat',
      apiStyle: 'openai-responses',
      capabilities: ['reasoning', 'tool_use'],
    })

    const chatModel = model.exposeChatModel({ sessionId: 'session-123' })

    expect(openAIMocks.responses).toHaveBeenCalledWith('gpt-5-mini')
    expect(chatModel.modelId).toBe('gpt-5-mini')
  })

  it('forces store=false for openai-responses gateway requests while preserving user OpenAI provider options', () => {
    const model = createModel({
      modelId: 'gpt-5.5',
      type: 'chat',
      apiStyle: 'openai-responses',
      capabilities: ['reasoning', 'tool_use'],
    })

    const settings = model.exposeCallSettings({
      providerOptions: {
        openai: {
          reasoningEffort: 'high',
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      openai: {
        reasoningEffort: 'high',
        store: false,
      },
    })
  })

  it('forces store=false for openai-responses gateway requests without user provider options', () => {
    const model = createModel({
      modelId: 'gpt-5.5',
      type: 'chat',
      apiStyle: 'openai-responses',
      capabilities: ['reasoning', 'tool_use'],
    })

    const settings = model.exposeCallSettings({})

    expect(settings.providerOptions).toEqual({
      openai: {
        store: false,
      },
    })
  })

  it('maps only wire-compatible OpenAI reasoning options to the compatible gateway', () => {
    const model = createModel({
      modelId: 'gpt-5.5',
      type: 'chat',
      apiStyle: 'openai',
      capabilities: ['reasoning', 'tool_use'],
    })

    const settings = model.exposeCallSettings({
      providerOptions: {
        openai: {
          reasoningEffort: 'low',
          forceReasoning: true,
          reasoningSummary: 'auto',
          include: ['reasoning.encrypted_content'],
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      openaiCompatible: {
        reasoningEffort: 'low',
      },
      ChatboxAI: {
        reasoningEffort: 'low',
      },
    })
  })

  it('ignores stale openaiCompatible options and keeps the current reasoning effort', () => {
    const model = createModel({
      modelId: 'gpt-5.5',
      type: 'chat',
      apiStyle: 'openai',
      capabilities: ['reasoning', 'tool_use'],
    })

    // A session that previously used a Qwen model can retain openaiCompatible thinking
    // options; those keys must not reach the GPT gateway body, and the freshly set
    // reasoning effort must not be dropped by namespace precedence.
    const settings = model.exposeCallSettings({
      providerOptions: {
        openaiCompatible: {
          enable_thinking: true,
          thinking_budget: 4096,
        },
        openai: {
          reasoningEffort: 'medium',
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      openaiCompatible: {
        reasoningEffort: 'medium',
      },
      ChatboxAI: {
        reasoningEffort: 'medium',
      },
    })
  })

  it('sends no gateway extra body when only stale non-effort openaiCompatible options remain', () => {
    const model = createModel({
      modelId: 'gpt-5.5',
      type: 'chat',
      apiStyle: 'openai',
      capabilities: ['reasoning', 'tool_use'],
    })

    const settings = model.exposeCallSettings({
      providerOptions: {
        openaiCompatible: {
          enable_thinking: true,
          thinking_budget: 4096,
        },
      },
    })

    expect(settings.providerOptions).toBeUndefined()
  })

  it('sends no gateway extra body when OpenAI options carry no reasoning effort', () => {
    const model = createModel({
      modelId: 'gpt-5.5',
      type: 'chat',
      apiStyle: 'openai',
      capabilities: ['reasoning', 'tool_use'],
    })

    const settings = model.exposeCallSettings({
      providerOptions: {
        openai: {
          forceReasoning: true,
        },
      },
    })

    expect(settings.providerOptions).toBeUndefined()
  })

  it('maps DeepSeek thinking through ChatboxAI gateway with native thinking options', () => {
    const model = createModel({
      modelId: 'deepseek-v4-pro',
      type: 'chat',
      apiStyle: 'openai',
      capabilities: ['reasoning', 'tool_use'],
    })

    const settings = model.exposeCallSettings({
      providerOptions: {
        deepseek: {
          thinking: {
            type: 'enabled',
          },
          reasoningEffort: 'max',
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      deepseek: {
        thinking: {
          type: 'enabled',
        },
        reasoningEffort: 'max',
      },
    })
  })

  it('maps ChatboxAI DeepSeek thinking and effort to Anthropic provider options', () => {
    const model = createModel({
      modelId: 'deepseek-v4-pro',
      type: 'chat',
      apiStyle: 'anthropic',
      capabilities: ['tool_use'],
    })

    const enabled = model.exposeCallSettings({
      providerOptions: {
        claude: { thinking: { type: 'enabled' }, effort: 'max' },
      },
    })
    const disabled = model.exposeCallSettings({
      providerOptions: {
        claude: { thinking: { type: 'disabled' }, effort: 'max' },
      },
    })

    expect(enabled.providerOptions).toEqual({
      anthropic: { thinking: { type: 'enabled' }, effort: 'max' },
    })
    expect(disabled.providerOptions).toEqual({
      anthropic: { thinking: { type: 'disabled' } },
    })
  })

  it('maps ChatboxAI DeepSeek effort to Responses provider options', () => {
    const model = createModel({
      modelId: 'deepseek-v4-pro',
      type: 'chat',
      apiStyle: 'openai-responses',
      capabilities: ['tool_use'],
    })

    const high = model.exposeCallSettings({
      providerOptions: {
        openai: { reasoningEffort: 'max', forceReasoning: true },
      },
    })
    const disabled = model.exposeCallSettings({
      providerOptions: {
        openai: { reasoningEffort: 'none', forceReasoning: true },
      },
    })

    expect(high.providerOptions).toEqual({
      openai: { reasoningEffort: 'max', forceReasoning: true, store: false },
    })
    expect(disabled.providerOptions).toEqual({
      openai: { reasoningEffort: 'none', forceReasoning: true, store: false },
    })
  })

  it.each(['openai', 'anthropic', 'openai-responses'] as const)(
    'drops sampling settings for ChatboxAI DeepSeek thinking through %s',
    (apiStyle) => {
      const model = createModel(
        {
          modelId: 'deepseek-v4-pro',
          type: 'chat',
          apiStyle,
          capabilities: ['reasoning'],
        },
        { temperature: 0.7, topP: 0.9 }
      )

      const settings = model.exposeCallSettings({})

      expect(settings.temperature).toBeUndefined()
      expect(settings.topP).toBeUndefined()
    }
  )

  it('restores sampling settings when ChatboxAI DeepSeek thinking is explicitly disabled', () => {
    const model = createModel(
      {
        modelId: 'deepseek-v4-pro',
        type: 'chat',
        apiStyle: 'openai',
        capabilities: ['reasoning'],
      },
      { temperature: 0.7, topP: 0.9 }
    )

    const settings = model.exposeCallSettings({
      providerOptions: { deepseek: { thinking: { type: 'disabled' } } },
    })

    expect(settings.temperature).toBe(0.7)
    expect(settings.topP).toBe(0.9)
  })

  it('drops V4-only effort persisted on an older ChatboxAI DeepSeek model', () => {
    const model = createModel({
      modelId: 'deepseek-reasoner',
      type: 'chat',
      apiStyle: 'anthropic',
      capabilities: ['reasoning'],
    })

    const settings = model.exposeCallSettings({
      providerOptions: {
        claude: { thinking: { type: 'enabled' }, effort: 'max' },
      },
    })

    expect(settings.providerOptions).toEqual({
      anthropic: { thinking: { type: 'enabled' } },
    })
  })

  it('converts legacy ChatboxAI DeepSeek reasoning toggles to native thinking options', () => {
    const model = createModel({
      modelId: 'deepseek-v4-pro',
      type: 'chat',
      apiStyle: 'openai',
      capabilities: ['reasoning', 'tool_use'],
    })

    const settings = model.exposeCallSettings({
      providerOptions: {
        openaiCompatible: {
          reasoning: {
            enabled: false,
            exclude: true,
          },
        },
      },
    })

    expect(settings.providerOptions).toEqual({
      deepseek: {
        thinking: {
          type: 'disabled',
        },
      },
    })
  })
})

describe('ChatboxAI anthropic max output tokens', () => {
  it('defaults Chatbox AI Anthropic models to 8192 max output tokens', () => {
    const model = createModel({
      modelId: 'claude-sonnet-4-5',
      type: 'chat',
      apiStyle: 'anthropic',
    })

    expect(model.exposeCallSettings({}).maxOutputTokens).toBe(8192)
  })

  it('caps the default at the model output limit from the registry', () => {
    // claude-3-haiku's real limit is 4096; sending 8192 would be rejected upstream
    // for model ids @ai-sdk/anthropic does not know (it only clamps known ids)
    const model = createModel({
      modelId: 'claude-3-haiku-20240307',
      type: 'chat',
      apiStyle: 'anthropic',
    })

    expect(model.exposeCallSettings({}).maxOutputTokens).toBe(4096)
  })

  it('caps the default at model.maxOutput when the model info carries one', () => {
    const model = createModel({
      modelId: 'claude-future-model',
      type: 'chat',
      apiStyle: 'anthropic',
      maxOutput: 2000,
    })

    expect(model.exposeCallSettings({}).maxOutputTokens).toBe(2000)
  })

  it('falls back to 8192 for model ids unknown to the registry', () => {
    const model = createModel({
      modelId: 'claude-experimental-unknown',
      type: 'chat',
      apiStyle: 'anthropic',
    })

    expect(model.exposeCallSettings({}).maxOutputTokens).toBe(8192)
  })

  it('keeps explicit max output tokens for Chatbox AI Anthropic models', () => {
    const model = createModel(
      {
        modelId: 'claude-3-haiku-20240307',
        type: 'chat',
        apiStyle: 'anthropic',
      },
      { maxOutputTokens: 2048 }
    )

    expect(model.exposeCallSettings({}).maxOutputTokens).toBe(2048)
  })

  it('does not add the Anthropic default to non-Anthropic Chatbox AI models', () => {
    const model = createModel({
      modelId: 'gpt-5-mini',
      type: 'chat',
      apiStyle: 'openai-responses',
    })

    expect(model.exposeCallSettings({}).maxOutputTokens).toBeUndefined()
  })
})
