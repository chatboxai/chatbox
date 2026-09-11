import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import TrustedRouter from './models/trustedrouter'

export const trustedRouterProvider = defineProvider({
  id: ModelProviderEnum.TrustedRouter,
  name: 'TrustedRouter',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'trustedrouter',
  curatedModelIds: ['trustedrouter/auto', 'trustedrouter/zdr', 'trustedrouter/e2e', 'trustedrouter/cheap'],
  urls: {
    website: 'https://trustedrouter.com/',
  },
  defaultSettings: {
    apiHost: 'https://api.trustedrouter.com/v1',
    models: [
      {
        modelId: 'trustedrouter/auto',
        nickname: 'Auto (routes across healthy providers)',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 200_000,
      },
      {
        modelId: 'trustedrouter/zdr',
        nickname: 'ZDR (zero-data-retention routes)',
        capabilities: ['tool_use'],
        contextWindow: 200_000,
      },
      {
        modelId: 'trustedrouter/e2e',
        nickname: 'E2E (end-to-end encrypted routes)',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'trustedrouter/cheap',
        nickname: 'Cheap (cost-optimized routes)',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
    ],
  },
  createModel: (config) => {
    return new TrustedRouter(
      {
        apiKey: config.effectiveApiKey,
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
    return `TrustedRouter API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
