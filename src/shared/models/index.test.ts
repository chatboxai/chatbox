import { settings as getDefaultSettings, newConfigs } from 'src/shared/defaults'
import { getModel } from 'src/shared/providers'
import LongCat from 'src/shared/providers/definitions/models/longcat'
import OpenAI from 'src/shared/providers/definitions/models/openai'
import OpenAIResponses from 'src/shared/providers/definitions/models/openai-responses'
import Qwen from 'src/shared/providers/definitions/models/qwen'
import TencentHunyuan from 'src/shared/providers/definitions/models/tencent-hunyuan'
import XiaomiMiMo from 'src/shared/providers/definitions/models/xiaomi-mimo'
import ZhipuGLMCodingPlan from 'src/shared/providers/definitions/models/zhipu-glm-coding-plan'
import { ModelProviderEnum, type SessionSettings, type Settings } from 'src/shared/types'
import type { ModelDependencies } from 'src/shared/types/adapters'
import type { SentryScope } from 'src/shared/utils/sentry_adapter'
import { describe, expect, it, vi } from 'vitest'

const mockScope: SentryScope = {
  setTag: vi.fn(),
  setExtra: vi.fn(),
}

const mockDependencies: ModelDependencies = {
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

  it('inherits built-in tool capabilities for an older persisted DeepSeek model', () => {
    const sessionSettings: SessionSettings = {
      provider: ModelProviderEnum.DeepSeek,
      modelId: 'deepseek-v4-flash',
    }
    const defaultSettings = getDefaultSettings()
    const globalSettings: Settings = {
      ...defaultSettings,
      providers: {
        ...defaultSettings.providers,
        [ModelProviderEnum.DeepSeek]: {
          apiKey: 'test-key',
          models: [{ modelId: 'deepseek-v4-flash' }],
        },
      },
    }

    const model = getModel(sessionSettings, globalSettings, newConfigs(), mockDependencies)

    expect(model.isSupportToolUse('agent')).toBe(true)
  })

  it.each([
    [ModelProviderEnum.Qwen, 'qwen3.5-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1', Qwen],
    [ModelProviderEnum.QwenPortal, 'coder-model', 'https://portal.qwen.ai/v1', Qwen],
    [ModelProviderEnum.MiniMax, 'MiniMax-M2.5', 'https://api.minimax.io/v1', OpenAI],
    [ModelProviderEnum.MiniMaxCN, 'MiniMax-M2.5', 'https://api.minimaxi.com/v1', OpenAI],
    [ModelProviderEnum.Moonshot, 'kimi-k2.5', 'https://api.moonshot.ai/v1', OpenAI],
    [ModelProviderEnum.MoonshotCN, 'kimi-k2.5', 'https://api.moonshot.cn/v1', OpenAI],
    [ModelProviderEnum.OpenCodeGo, 'glm-5.3', 'https://opencode.ai/zen/go/v1', OpenAI],
    [ModelProviderEnum.OpenCodeZen, 'glm-5.2', 'https://opencode.ai/zen/v1', OpenAI],
    [
      ModelProviderEnum.TencentHunyuan,
      'hunyuan-turbos-latest',
      'https://api.hunyuan.cloud.tencent.com/v1',
      TencentHunyuan,
    ],
    [ModelProviderEnum.XiaomiMiMo, 'mimo-v2.5-pro', 'https://api.xiaomimimo.com/v1', XiaomiMiMo],
    [ModelProviderEnum.LongCat, 'LongCat-2.0', 'https://api.longcat.chat/openai/v1', LongCat],
    [
      ModelProviderEnum.ZhipuGLMCodingPlan,
      'glm-5.3',
      'https://open.bigmodel.cn/api/coding/paas/v4',
      ZhipuGLMCodingPlan,
    ],
  ])('returns OpenAI-compatible model instances for %s', (provider, modelId, apiHost, expectedModelClass) => {
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

    expect(model).toBeInstanceOf(expectedModelClass)
  })
})
