import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import FuturMix from './models/futurmix'

export const futurMixProvider = defineProvider({
  id: ModelProviderEnum.FuturMix,
  name: 'FuturMix',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'futurmix',
  urls: {
    website: 'https://futurmix.ai/',
  },
  defaultSettings: {
    apiHost: 'https://futurmix.ai',
    models: [
      // --- Anthropic ---
      {
        modelId: 'claude-opus-4-7',
        nickname: 'Claude Opus 4-7',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 200_000,
        maxOutput: 32_000,
      },
      {
        modelId: 'claude-opus-4-6',
        nickname: 'Claude Opus 4-6',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 200_000,
        maxOutput: 32_000,
      },
      {
        modelId: 'claude-sonnet-4-6',
        nickname: 'Claude Sonnet 4-6',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 200_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'claude-sonnet-4-5-20250929',
        nickname: 'Claude Sonnet 4.5',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 200_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'claude-haiku-4-5-20251001',
        nickname: 'Claude Haiku 4.5',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 200_000,
        maxOutput: 8_192,
      },
      // --- Google ---
      {
        modelId: 'gemini-2.5-pro',
        nickname: 'Gemini 2.5 Pro',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'gemini-2.5-flash',
        nickname: 'Gemini 2.5 Flash',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      // --- OpenAI ---
      {
        modelId: 'gpt-5.4',
        nickname: 'GPT-5.4',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 128_000,
        maxOutput: 16_384,
      },
      {
        modelId: 'gpt-5.4-mini',
        nickname: 'GPT-5.4 Mini',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 128_000,
        maxOutput: 16_384,
      },
    ],
  },
  createModel: (config) => {
    return new FuturMix(
      {
        apiKey: config.providerSetting.apiKey || '',
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
    return `FuturMix API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
