import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import DaoXE from './models/daoxe'

export const daoxeProvider = defineProvider({
  id: ModelProviderEnum.DaoXE,
  name: 'DaoXE',
  type: ModelProviderType.OpenAI,
  description: 'OpenAI-compatible multi-model API gateway',
  urls: {
    website: 'https://daoxe.com/',
    docs: 'https://github.com/seven7763/DaoXE-AI',
    models: 'https://daoxe.com/pricing',
  },
  defaultSettings: {
    apiHost: 'https://daoxe.com/v1',
  },
  createModel: (config) => {
    return new DaoXE(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || 'https://daoxe.com/v1',
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        useProxy: config.providerSetting.useProxy,
        stream: config.settings.stream,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `DaoXE (${providerSettings?.models?.find((model) => model.modelId === modelId)?.nickname || modelId})`
  },
})
