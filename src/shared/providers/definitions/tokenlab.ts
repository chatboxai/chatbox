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
  ],
  urls: {
    website: 'https://tokenlab.sh/',
    apiKey: 'https://tokenlab.sh/dashboard',
    docs: 'https://tokenlab.sh/docs',
    models: 'https://api.tokenlab.sh/v1/models',
  },
  defaultSettings: {
    apiHost: 'https://api.tokenlab.sh/v1',
    models: [
      {
        modelId: 'claude-fable-5',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
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
        capabilities: [],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'deepseek-v4-pro',
        capabilities: ['tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 384_000,
      },
      {
        modelId: 'deepseek-v4-flash',
        capabilities: ['tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 384_000,
      },
      {
        modelId: 'gpt-5.5',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.4',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.4-mini',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'minimax-m3',
        capabilities: ['tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 524_288,
      },
      {
        modelId: 'kimi-k2.7-code',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 262_144,
        maxOutput: 131_072,
      },
      {
        modelId: 'qwen3.7-max',
        capabilities: [],
        contextWindow: 991_808,
        maxOutput: 65_536,
      },
      {
        modelId: 'gemini-3.5-flash',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'gemini-3.1-flash-lite',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'grok-4.3',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 131_072,
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
