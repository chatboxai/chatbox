import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { CallSettings } from '@shared/models/abstract-ai-sdk'
import type { CallChatCompletionOptions } from '@shared/models/types'
import type { ProviderModelInfo } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DeepSeek from './deepseek'

const providerMocks = vi.hoisted(() => {
  const languageModel: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'deepseek',
    modelId: 'deepseek-v4-flash',
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  }

  const createDeepSeek = vi.fn(() => ({
    chat: vi.fn(() => languageModel),
    languageModel: vi.fn(() => languageModel),
    chatModel: vi.fn(() => languageModel),
  }))
  const createOpenAICompatible = vi.fn(() => ({
    chat: vi.fn(() => languageModel),
    languageModel: vi.fn(() => languageModel),
    chatModel: vi.fn(() => languageModel),
  }))

  return {
    createDeepSeek,
    createOpenAICompatible,
    languageModel,
  }
})

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: providerMocks.createDeepSeek,
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: providerMocks.createOpenAICompatible,
}))

class TestDeepSeek extends DeepSeek {
  public exposeCallSettings(options: CallChatCompletionOptions): CallSettings {
    return this.getCallSettings(options)
  }

  public exposeProvider() {
    return this.getProvider()
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

function createModel(model: ProviderModelInfo) {
  return new TestDeepSeek(
    {
      apiKey: 'test-api-key',
      model,
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 4096,
    },
    createDependencies()
  )
}

describe('DeepSeek vision transport', () => {
  beforeEach(() => {
    providerMocks.createDeepSeek.mockClear()
    providerMocks.createOpenAICompatible.mockClear()
  })

  it('uses the native DeepSeek SDK for non-vision models', () => {
    const model = createModel({
      modelId: 'deepseek-v4-flash',
      capabilities: ['reasoning', 'tool_use'],
    })

    model.exposeProvider()
    model.exposeChatModel({})

    expect(providerMocks.createDeepSeek).toHaveBeenCalledTimes(2)
    expect(providerMocks.createOpenAICompatible).not.toHaveBeenCalled()
  })

  it('routes vision models through the OpenAI-compatible transport so image parts are preserved', () => {
    const model = createModel({
      modelId: 'deepseek-v4-flash-vision-exp',
      capabilities: ['reasoning', 'tool_use', 'vision'],
    })

    model.exposeProvider()
    model.exposeChatModel({})

    expect(providerMocks.createOpenAICompatible).toHaveBeenCalledWith({
      name: 'DeepSeek',
      apiKey: 'test-api-key',
      baseURL: 'https://api.deepseek.com',
    })
    expect(providerMocks.createDeepSeek).not.toHaveBeenCalled()
  })

  it('maps DeepSeek thinking options to OpenAI-compatible provider options for vision models', () => {
    const model = createModel({
      modelId: 'deepseek-v4-flash-vision-exp',
      capabilities: ['reasoning', 'tool_use', 'vision'],
    })

    const settings = model.exposeCallSettings({
      providerOptions: {
        deepseek: {
          thinking: { type: 'enabled' },
          reasoningEffort: 'high',
        },
      },
    })

    expect(settings.temperature).toBeUndefined()
    expect(settings.topP).toBeUndefined()
    expect(settings.providerOptions).toEqual({
      openaiCompatible: {
        thinking: { type: 'enabled' },
        reasoningEffort: 'high',
      },
      DeepSeek: {
        thinking: { type: 'enabled' },
        reasoningEffort: 'high',
      },
    })
  })
})
