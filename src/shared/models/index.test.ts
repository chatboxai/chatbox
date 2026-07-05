import { settings as getDefaultSettings, newConfigs } from 'src/shared/defaults'
import { getModel } from 'src/shared/providers'
import OpenAI from 'src/shared/providers/definitions/models/openai'
import OpenAIResponses from 'src/shared/providers/definitions/models/openai-responses'
import { ModelProviderEnum, type SessionSettings, type Settings } from 'src/shared/types'
import type { ModelDependencies } from 'src/shared/types/adapters'
import { describe, expect, it, vi } from 'vitest'

const mockDependencies: ModelDependencies = {
  request: {
    fetchWithOptions: vi.fn(),
    apiRequest: vi.fn(),
  },
  storage: {
    saveImage: vi.fn(),
    getImage: vi.fn(),
  },
  platformType: 'desktop',
  oauth: {
    refreshCredential: vi.fn(),
    persistCredential: vi.fn(),
    clearCredential: vi.fn(),
  },
}

describe('getModel', () => {
  it('returns OpenAIResponses when provider is OpenAIResponses', () => {
    const sessionSettings: SessionSettings = {
      provider: ModelProviderEnum.OpenAIResponses,
      modelId: 'gpt-5-pro',
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 2048,
      stream: true,
    }

    const defaultSettings = getDefaultSettings()
    const globalSettings: Settings = {
      ...defaultSettings,
      providers: {
        ...defaultSettings.providers,
        [ModelProviderEnum.OpenAIResponses]: {
          apiKey: 'test-key',
          apiHost: 'https://api.openai.com',
          models: [{ modelId: 'gpt-5-pro' }],
        },
      },
    }

    const model = getModel(sessionSettings, globalSettings, newConfigs(), mockDependencies)

    expect(model).toBeInstanceOf(OpenAIResponses)
  })

  it('returns OpenAIResponses when OpenAI uses OAuth mode', () => {
    const sessionSettings: SessionSettings = {
      provider: ModelProviderEnum.OpenAI,
      modelId: 'gpt-5',
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 2048,
      stream: true,
    }

    const defaultSettings = getDefaultSettings()
    const globalSettings: Settings = {
      ...defaultSettings,
      providers: {
        ...defaultSettings.providers,
        [ModelProviderEnum.OpenAI]: {
          activeAuthMode: 'oauth',
          oauth: {
            accessToken: 'oauth-token',
          },
          models: [{ modelId: 'gpt-5' }],
        },
      },
    }

    const model = getModel(sessionSettings, globalSettings, newConfigs(), mockDependencies)

    expect(model).toBeInstanceOf(OpenAIResponses)
  })

  it('returns OpenAIResponses when openai-responses enables OAuth with shared OpenAI credentials', () => {
    const sessionSettings: SessionSettings = {
      provider: ModelProviderEnum.OpenAIResponses,
      modelId: 'gpt-5-pro',
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 2048,
      stream: true,
    }

    const defaultSettings = getDefaultSettings()
    const globalSettings: Settings = {
      ...defaultSettings,
      providers: {
        ...defaultSettings.providers,
        [ModelProviderEnum.OpenAI]: {
          oauth: {
            accessToken: 'oauth-token',
          },
        },
        [ModelProviderEnum.OpenAIResponses]: {
          activeAuthMode: 'oauth',
          models: [{ modelId: 'gpt-5-pro' }],
        },
      },
    }

    const model = getModel(sessionSettings, globalSettings, newConfigs(), mockDependencies)

    expect(model).toBeInstanceOf(OpenAIResponses)
  })

  it.each([
    [ModelProviderEnum.Qwen, 'qwen3.5-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    [ModelProviderEnum.QwenPortal, 'coder-model', 'https://portal.qwen.ai/v1'],
    [ModelProviderEnum.MiniMax, 'MiniMax-M2.5', 'https://api.minimax.io/v1'],
    [ModelProviderEnum.MiniMaxCN, 'MiniMax-M2.5', 'https://api.minimaxi.com/v1'],
    [ModelProviderEnum.Moonshot, 'kimi-k2.5', 'https://api.moonshot.ai/v1'],
    [ModelProviderEnum.MoonshotCN, 'kimi-k2.5', 'https://api.moonshot.cn/v1'],
  ])('returns OpenAI-compatible model instances for %s', (provider, modelId, apiHost) => {
    const sessionSettings: SessionSettings = {
      provider,
      modelId,
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 2048,
      stream: true,
    }

    const defaultSettings = getDefaultSettings()
    const globalSettings: Settings = {
      ...defaultSettings,
      providers: {
        ...defaultSettings.providers,
        [provider]: {
          apiKey: 'test-key',
          apiHost,
          models: [{ modelId }],
        },
      },
    }

    const model = getModel(sessionSettings, globalSettings, newConfigs(), mockDependencies)

    expect(model).toBeInstanceOf(OpenAI)
  })
})
