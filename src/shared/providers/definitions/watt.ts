import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Watt from './models/watt'

export const WATT_API_HOST = 'https://api.watt-cloud.com/v1'

export const wattProvider = defineProvider({
  id: ModelProviderEnum.WattCloud,
  name: 'Watt Cloud',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://www.watt-cloud.com',
    docs: 'https://www.watt-cloud.com/docs/',
    apiKey: 'https://www.watt-cloud.com/workspaces/keys',
  },
  defaultSettings: {
    apiHost: WATT_API_HOST,
    models: [
      {
        modelId: 'DeepSeek-V4-Pro',
        nickname: 'DeepSeek V4 Pro',
        contextWindow: 1_048_576,
        maxOutput: 384_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'DeepSeek-V4-Flash',
        nickname: 'DeepSeek V4 Flash',
        contextWindow: 1_048_576,
        maxOutput: 384_000,
        capabilities: ['reasoning', 'tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new Watt(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || WATT_API_HOST,
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
    return `Watt Cloud (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
