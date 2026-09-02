import { describe, expect, it, vi } from 'vitest'
import { settings as getDefaultSettings, newConfigs } from '../../defaults'
import { getModel } from '../../providers'
import type { SessionSettings, Settings } from '../../types'
import { ModelProviderEnum } from '../../types'
import type { ModelDependencies } from '../../types/adapters'
import type { SentryScope } from '../../utils/sentry_adapter'
import CustomClaude from './models/custom-claude'
import CustomGemini from './models/custom-gemini'
import OpenAI from './models/openai'
import OpenAIResponses from './models/openai-responses'
import { applyOpenCodeZenModelMetadata, getOpenCodeZenApiStyle, OPENCODE_ZEN_API_HOST } from './opencode-zen'

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
    provider: ModelProviderEnum.OpenCodeZen,
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
      [ModelProviderEnum.OpenCodeZen]: {
        apiKey: 'sk-test',
        apiHost: OPENCODE_ZEN_API_HOST,
        models: [{ modelId }],
      },
    },
  }
  return getModel(sessionSettings, globalSettings, newConfigs(), mockDependencies)
}

describe('OpenCode Zen API style routing', () => {
  it.each([
    ['gpt-5.6-sol', 'openai-responses'],
    ['gpt-5.1-codex-mini', 'openai-responses'],
    ['grok-4.6', 'openai-responses'],
    ['muse-spark-1.2', 'openai-responses'],
    ['muse-spark-1.2-contributor-free', 'openai-responses'],
    ['claude-opus-5', 'anthropic'],
    ['claude-haiku-4-5', 'anthropic'],
    ['qwen3.6-plus', 'anthropic'],
    ['gemini-3.7-flash', 'google'],
    ['gemini-3.1-pro', 'google'],
    ['deepseek-v4-pro', 'openai'],
    ['glm-5.2', 'openai'],
    ['kimi-k3', 'openai'],
    // MiniMax is Chat Completions on Zen, unlike Go where it is Anthropic Messages.
    ['minimax-m3', 'openai'],
    ['big-pickle', 'openai'],
    ['nemotron-3-ultra-free', 'openai'],
  ] as const)('maps %s to %s', (modelId, apiStyle) => {
    expect(getOpenCodeZenApiStyle(modelId)).toBe(apiStyle)
  })

  it('stamps apiStyle from the model id even when a record already has the provider-type fallback', () => {
    expect(applyOpenCodeZenModelMetadata({ modelId: 'claude-sonnet-5' }).apiStyle).toBe('anthropic')
    expect(applyOpenCodeZenModelMetadata({ modelId: 'gemini-3.7-flash', apiStyle: 'openai' }).apiStyle).toBe('google')
    expect(applyOpenCodeZenModelMetadata({ modelId: 'gpt-5.6-luna', apiStyle: 'openai' }).apiStyle).toBe(
      'openai-responses'
    )
  })
})

describe('OpenCode Zen model factory', () => {
  it('creates Responses models for GPT, Grok and Muse Spark', () => {
    expect(createModel('gpt-5.6-sol')).toBeInstanceOf(OpenAIResponses)
    expect(createModel('grok-4.6')).toBeInstanceOf(OpenAIResponses)
    expect(createModel('muse-spark-1.2')).toBeInstanceOf(OpenAIResponses)
  })

  it('creates OpenAI-compatible models for chat completions endpoints', () => {
    expect(createModel('glm-5.2')).toBeInstanceOf(OpenAI)
    expect(createModel('minimax-m3')).toBeInstanceOf(OpenAI)
    expect(createModel('big-pickle')).toBeInstanceOf(OpenAI)
  })

  it('creates Anthropic-compatible models for Claude and Qwen', () => {
    expect(createModel('claude-opus-5')).toBeInstanceOf(CustomClaude)
    expect(createModel('qwen3.6-plus')).toBeInstanceOf(CustomClaude)
  })

  it('creates Gemini models for the Google surface', () => {
    expect(createModel('gemini-3.7-flash')).toBeInstanceOf(CustomGemini)
  })

  it('routes by model id even when the stored record still has the OpenAI provider-type fallback', () => {
    const sessionSettings: SessionSettings = {
      provider: ModelProviderEnum.OpenCodeZen,
      modelId: 'claude-opus-5',
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
        [ModelProviderEnum.OpenCodeZen]: {
          apiKey: 'sk-test',
          apiHost: OPENCODE_ZEN_API_HOST,
          models: [{ modelId: 'claude-opus-5', apiStyle: 'openai' }],
        },
      },
    }

    expect(getModel(sessionSettings, globalSettings, newConfigs(), mockDependencies)).toBeInstanceOf(CustomClaude)
  })
})
