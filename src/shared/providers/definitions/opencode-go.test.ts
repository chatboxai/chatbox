import { describe, expect, it, vi } from 'vitest'
import { settings as getDefaultSettings, newConfigs } from '../../defaults'
import { getModel } from '../../providers'
import type { SessionSettings, Settings } from '../../types'
import { ModelProviderEnum } from '../../types'
import type { ModelDependencies } from '../../types/adapters'
import type { SentryScope } from '../../utils/sentry_adapter'
import CustomClaude from './models/custom-claude'
import OpenAI from './models/openai'
import OpenAIResponses from './models/openai-responses'
import { applyOpenCodeGoModelMetadata, getOpenCodeGoApiStyle, OPENCODE_GO_API_HOST } from './opencode-go'

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

function createModel(modelId: string) {
  const sessionSettings: SessionSettings = {
    provider: ModelProviderEnum.OpenCodeGo,
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
      [ModelProviderEnum.OpenCodeGo]: {
        apiKey: 'sk-test',
        apiHost: OPENCODE_GO_API_HOST,
        models: [{ modelId }],
      },
    },
  }
  return getModel(sessionSettings, globalSettings, newConfigs(), mockDependencies)
}

describe('OpenCode Go API style routing', () => {
  it.each([
    ['grok-4.5', 'openai-responses'],
    ['gpt-5.6-luna', 'openai-responses'],
    ['muse-spark-1.2-contributor', 'openai-responses'],
    ['glm-5.3', 'openai'],
    ['kimi-k3', 'openai'],
    ['deepseek-v4-flash', 'openai'],
    ['hy3', 'openai'],
    ['minimax-m3', 'anthropic'],
    ['minimax-m2.7', 'anthropic'],
    ['minimax-m2.5', 'anthropic'],
    ['qwen3.8-max', 'anthropic'],
    ['qwen3.7-plus', 'anthropic'],
  ] as const)('maps %s to %s', (modelId, apiStyle) => {
    expect(getOpenCodeGoApiStyle(modelId)).toBe(apiStyle)
  })

  it('stamps apiStyle from the model id even when a record already has the provider-type fallback', () => {
    expect(applyOpenCodeGoModelMetadata({ modelId: 'qwen3.6-plus' }).apiStyle).toBe('anthropic')
    expect(applyOpenCodeGoModelMetadata({ modelId: 'grok-4.5' }).apiStyle).toBe('openai-responses')
    expect(applyOpenCodeGoModelMetadata({ modelId: 'qwen3.8-max', apiStyle: 'openai' }).apiStyle).toBe('anthropic')
  })
})

describe('OpenCode Go model factory', () => {
  it('creates Responses models for Grok, GPT 5.6 Luna and Muse Spark', () => {
    expect(createModel('grok-4.5')).toBeInstanceOf(OpenAIResponses)
    expect(createModel('gpt-5.6-luna')).toBeInstanceOf(OpenAIResponses)
    expect(createModel('muse-spark-1.2-contributor')).toBeInstanceOf(OpenAIResponses)
  })

  it('creates OpenAI-compatible models for chat completions endpoints', () => {
    expect(createModel('glm-5.3')).toBeInstanceOf(OpenAI)
    expect(createModel('deepseek-v4-flash')).toBeInstanceOf(OpenAI)
  })

  it('creates Anthropic-compatible models for MiniMax and Qwen', () => {
    expect(createModel('minimax-m3')).toBeInstanceOf(CustomClaude)
    expect(createModel('minimax-m2.5')).toBeInstanceOf(CustomClaude)
    expect(createModel('qwen3.8-max')).toBeInstanceOf(CustomClaude)
  })

  it('routes by model id even when the stored record still has the OpenAI provider-type fallback', () => {
    const sessionSettings: SessionSettings = {
      provider: ModelProviderEnum.OpenCodeGo,
      modelId: 'qwen3.8-max',
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
        [ModelProviderEnum.OpenCodeGo]: {
          apiKey: 'sk-test',
          apiHost: OPENCODE_GO_API_HOST,
          models: [{ modelId: 'qwen3.8-max', apiStyle: 'openai' }],
        },
      },
    }

    expect(getModel(sessionSettings, globalSettings, newConfigs(), mockDependencies)).toBeInstanceOf(CustomClaude)
  })
})
