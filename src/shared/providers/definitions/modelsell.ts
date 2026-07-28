import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import OpenAI from './models/openai'

export const modelsellProvider = defineProvider({
  id: ModelProviderEnum.Modelsell,
  name: 'Modelsell',
  type: ModelProviderType.OpenAI,
  description: 'Access multiple AI models through the Modelsell OpenAI-compatible API.',
  urls: {
    website: 'https://modelsell.com',
    apiKey: 'https://modelsell.com/console/token',
    docs: 'https://modelsell.com/docs/api-reference',
    models: 'https://modelsell.com/v1/models',
  },
  defaultSettings: {
    apiHost: 'https://modelsell.com/v1',
    models: [],
  },
  createModel: (config) => {
    return new OpenAI(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost,
        model: config.model,
        dalleStyle: config.settings.dalleStyle || 'vivid',
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        injectDefaultMetadata: config.globalSettings.injectDefaultMetadata,
        useProxy: false,
        stream: config.settings.stream,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `Modelsell (${providerSettings?.models?.find((model) => model.modelId === modelId)?.nickname || modelId})`
  },
})
