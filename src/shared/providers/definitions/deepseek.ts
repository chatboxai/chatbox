import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import DeepSeek from './models/deepseek'

export const deepseekProvider = defineProvider({
  id: ModelProviderEnum.DeepSeek,
  name: 'DeepSeek',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'deepseek',
  curatedModelIds: ['deepseek-flash', 'deepseek-v4-pro'],
  urls: {
    website: 'https://www.deepseek.com/',
  },
  defaultSettings: {
    models: [
      {
        modelId: 'deepseek-flash',
        nickname: 'DeepSeek Flash',
        capabilities: ['reasoning', 'tool_use', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 384_000,
      },
      {
        modelId: 'deepseek-v4-pro',
        nickname: 'DeepSeek V4 Pro',
        contextWindow: 1_000_000,
        maxOutput: 384_000,
        capabilities: ['reasoning', 'tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new DeepSeek(
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
    return `DeepSeek API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
