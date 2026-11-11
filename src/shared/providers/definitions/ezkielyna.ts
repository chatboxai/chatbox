import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Ezkielyna from './models/ezkielyna'

const EZKIELYNA_API_HOST = 'https://api.ezkielyna.store/v1'

export const ezkielynaProvider = defineProvider({
  id: ModelProviderEnum.Ezkielyna,
  name: 'Ezkielyna',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://ezkielyna.store',
    apiKey: 'https://api.ezkielyna.store/console/token',
    docs: 'https://ezkielyna.store/panduan/chatbox',
    models: 'https://ezkielyna.store/models',
  },
  defaultSettings: {
    apiHost: EZKIELYNA_API_HOST,
    // A short starting list. The full list for a key comes from the Fetch button (GET /v1/models).
    models: [
      {
        modelId: 'deepseek-v4.1-flash',
        nickname: 'DeepSeek V4.1 Flash',
        capabilities: ['reasoning'],
      },
      {
        modelId: 'deepseek-v4-pro',
        nickname: 'DeepSeek V4 Pro',
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'glm-5.3',
        nickname: 'GLM-5.3',
        capabilities: ['reasoning', 'tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new Ezkielyna(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || EZKIELYNA_API_HOST,
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
    return `Ezkielyna (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
