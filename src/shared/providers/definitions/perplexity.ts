import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Perplexity from './models/perplexity'

export const perplexityProvider = defineProvider({
  id: ModelProviderEnum.Perplexity,
  name: 'Perplexity',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'perplexity',
  curatedModelIds: ['sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research'],
  urls: {
    website: 'https://www.perplexity.ai/',
  },
  defaultSettings: {
    models: [
      { modelId: 'sonar-pro', capabilities: ['web_search'] },
      { modelId: 'sonar-reasoning-pro', capabilities: ['reasoning', 'web_search'] },
      { modelId: 'sonar-deep-research', capabilities: ['reasoning', 'web_search'] },
    ],
  },
  createModel: (config) => {
    return new Perplexity(
      {
        perplexityApiKey: config.providerSetting.apiKey || '',
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
    return `Perplexity API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
