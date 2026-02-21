import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import LLMApi from './models/llmapi'

export const llmapiProvider = defineProvider({
  id: ModelProviderEnum.LLMApi,
  name: 'LLM API',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://llmapi.ai/',
  },
  defaultSettings: {
    apiHost: 'https://api.llmapi.ai',
    models: [],
  },
  createModel: (config) => {
    return new LLMApi(
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
    return `LLM API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
