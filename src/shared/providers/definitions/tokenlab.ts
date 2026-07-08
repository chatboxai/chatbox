import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import TokenLab from './models/tokenlab'

export const tokenLabProvider = defineProvider({
  id: ModelProviderEnum.TokenLab,
  name: 'TokenLab',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'tokenlab',
  curatedModelIds: [
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-sonnet-5',
    'glm-5.2',
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'minimax-m3',
    'kimi-k2.7-code',
    'qwen3.7-max',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'grok-4.3',
    'grok-4-fast',
  ],
  urls: {
    website: 'https://tokenlab.sh/',
    apiKey: 'https://tokenlab.sh/dashboard',
    docs: 'https://docs.tokenlab.sh/',
    models: 'https://api.tokenlab.sh/v1/models',
  },
  defaultSettings: {
    apiHost: 'https://api.tokenlab.sh/v1',
    models: [
      {
        modelId: 'claude-fable-5',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 200_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'claude-opus-4-8',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'claude-sonnet-5',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'glm-5.2',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 128_000,
        maxOutput: 96_000,
      },
      {
        modelId: 'deepseek-v4-pro',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 163_840,
        maxOutput: 163_840,
      },
      {
        modelId: 'deepseek-v4-flash',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
        maxOutput: 32_768,
      },
      {
        modelId: 'gpt-5.5',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.4',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.4-mini',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'minimax-m3',
        capabilities: ['tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'kimi-k2.7-code',
        capabilities: ['tool_use'],
        contextWindow: 262_144,
        maxOutput: 65_536,
      },
      {
        modelId: 'qwen3.7-max',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 262_144,
        maxOutput: 65_536,
      },
      {
        modelId: 'gemini-3.5-flash',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'gemini-3.1-flash-lite',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'grok-4.3',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 256_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'grok-4-fast',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 2_000_000,
        maxOutput: 64_000,
      },
    ],
  },
  createModel: (config) => {
    return new TokenLab(
      {
        apiKey: config.effectiveApiKey,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `TokenLab API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
