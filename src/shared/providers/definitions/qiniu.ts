import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Qiniu from './models/qiniu'

export const qiniuProvider = defineProvider({
  id: ModelProviderEnum.Qiniu,
  name: 'Qiniu',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'qiniu',
  curatedModelIds: [
    // Top-tier flagship models
    'claude-sonnet-4.6',
    'claude-opus-4.6',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
  ],
  urls: {
    website: 'https://www.qiniu.com/ai/',
  },
  defaultSettings: {
    apiHost: 'https://api.qnaigc.com/v1',
    models: [
      // --- Anthropic ---
      {
        modelId: 'claude-sonnet-4.6',
        nickname: 'Claude Sonnet 4.6',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'claude-opus-4.6',
        nickname: 'Claude Opus 4.6',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      // --- Google ---
      {
        modelId: 'gemini-3-pro-preview',
        nickname: 'Gemini 3 Pro',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_050_000,
        maxOutput: 66_000,
      },
      {
        modelId: 'gemini-3-flash-preview',
        nickname: 'Gemini 3 Flash',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'gemini-2.5-pro',
        nickname: 'Gemini 2.5 Pro',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
    ],
  },
  createModel: (config) => {
    return new Qiniu(
      {
        apiKey: config.providerSetting.apiKey || '',
        apiHost: config.formattedApiHost || 'https://api.qnaigc.com/v1',
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
    return `Qiniu API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
