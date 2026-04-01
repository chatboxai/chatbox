import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import DeepSeek from './models/deepseek'

export const deepseekProvider = defineProvider({
  id: ModelProviderEnum.DeepSeek,
  name: 'DeepSeek',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'deepseek',
  curatedModelIds: ['deepseek-chat', 'deepseek-reasoner'],
  urls: {
    website: 'https://www.deepseek.com/',
  },
  defaultSettings: {
    models: [
      {
        modelId: 'deepseek-chat',
        contextWindow: 128_000,
        capabilities: ['tool_use'],
      },
      {
        modelId: 'deepseek-reasoner',
        contextWindow: 128_000,
        capabilities: ['reasoning', 'tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new DeepSeek(
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
    return `DeepSeek API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
