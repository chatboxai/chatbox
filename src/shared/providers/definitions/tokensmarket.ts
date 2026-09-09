import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import TokenMarket from './models/tokensmarket'

export const tokenMarketProvider = defineProvider({
  id: ModelProviderEnum.TokenMarket,
  name: 'Token Market',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://www.tokensmarket.ai/',
    apiKey: 'https://www.tokensmarket.ai/docs/api-examples/api-key',
    docs: 'https://www.tokensmarket.ai/docs/api-examples/text-models',
    models: 'https://www.tokensmarket.ai/models',
  },
  defaultSettings: {
    apiHost: 'https://api.tokensmarket.ai/v1',
    models: [],
  },
  createModel: (config) =>
    new TokenMarket(
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
    `Token Market (${providerSettings?.models?.find((model) => model.modelId === modelId)?.nickname || modelId})`,
})
