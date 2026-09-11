import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Jalapeno from './models/jalapeno'

export const JALAPENO_API_HOST = 'https://api.jalapeno-cloud.ai/v1'

export const jalapenoProvider = defineProvider({
  id: ModelProviderEnum.Jalapeno,
  name: 'Jalapeno Cloud 50% Off',
  type: ModelProviderType.OpenAI,
  curatedModelIds: ['DeepSeek-V4-Pro', 'DeepSeek-V4-Flash'],
  urls: {
    website: 'https://www.jalapeno-cloud.ai',
    docs: 'https://www.jalapeno-cloud.ai/docs',
    models: 'https://www.jalapeno-cloud.ai/models',
  },
  defaultSettings: {
    apiHost: JALAPENO_API_HOST,
    models: [
      {
        modelId: 'DeepSeek-V4-Pro',
        nickname: 'DeepSeek V4 Pro',
        contextWindow: 1_000_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'DeepSeek-V4-Flash',
        nickname: 'DeepSeek V4 Flash',
        contextWindow: 1_000_000,
        capabilities: ['reasoning', 'tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new Jalapeno(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || JALAPENO_API_HOST,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
        useProxy: config.providerSetting.useProxy || false,
        listModelsFallback: config.providerSetting.models || jalapenoProvider.defaultSettings?.models,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `Jalapeno Cloud 50% Off (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
