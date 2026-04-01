import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Gemini from './models/gemini'

export const geminiProvider = defineProvider({
  id: ModelProviderEnum.Gemini,
  name: 'Gemini',
  type: ModelProviderType.Gemini,
  modelsDevProviderId: 'google',
  curatedModelIds: [
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.5-flash-image',
  ],
  urls: {
    website: 'https://gemini.google.com/',
  },
  defaultSettings: {
    apiHost: 'https://generativelanguage.googleapis.com',
    // https://ai.google.dev/models/gemini
    models: [
      {
        modelId: 'gemini-3.1-pro-preview',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'gemini-3-flash-preview',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'gemini-2.5-flash',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'gemini-2.5-pro',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'gemini-2.5-flash-image',
        capabilities: ['vision'],
        contextWindow: 32_768,
        maxOutput: 8_192,
      },
    ],
  },
  createModel: (config) => {
    return new Gemini(
      {
        geminiAPIKey: config.providerSetting.apiKey || '',
        geminiAPIHost: config.formattedApiHost,
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
    return `Gemini API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
