import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import XAI from './models/xai'

export const xaiProvider = defineProvider({
  id: ModelProviderEnum.XAI,
  name: 'xAI',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'xai',
  curatedModelIds: ['grok-4', 'grok-4-fast', 'grok-4-1-fast', 'grok-4-1-fast-non-reasoning'],
  urls: {
    website: 'https://x.ai/',
  },
  defaultSettings: {
    apiHost: 'https://api.x.ai',
    models: [
      {
        modelId: 'grok-4',
        contextWindow: 256_000,
        capabilities: ['vision', 'tool_use', 'reasoning'],
      },
      {
        modelId: 'grok-4-fast',
        contextWindow: 2_000_000,
        capabilities: ['vision', 'tool_use', 'reasoning'],
      },
      {
        modelId: 'grok-4-1-fast',
        contextWindow: 2_000_000,
        capabilities: ['vision', 'tool_use', 'reasoning'],
      },
      {
        modelId: 'grok-4-1-fast-non-reasoning',
        contextWindow: 2_000_000,
        capabilities: ['vision', 'tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new XAI(
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
    return `xAI API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
