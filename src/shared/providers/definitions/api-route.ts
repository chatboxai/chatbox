import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import ApiRoute from './models/api-route'

export const apiRouteProvider = defineProvider({
  id: ModelProviderEnum.ApiRoute,
  name: 'API Route',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://www.api-route.com/',
    apiKey: 'https://www.api-route.com/api-keys',
    docs: 'https://www.api-route.com/docs/quickstart',
    models: 'https://www.api-route.com/pricing',
  },
  defaultSettings: {
    apiHost: 'https://global.api-route.com/v1',
    models: [],
  },
  createModel: (config) =>
    new ApiRoute(
      {
        apiKey: config.effectiveApiKey,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
      },
      config.dependencies
    ),
  getDisplayName: (modelId, providerSettings) =>
    `API Route (${providerSettings?.models?.find((model) => model.modelId === modelId)?.nickname || modelId})`,
})
