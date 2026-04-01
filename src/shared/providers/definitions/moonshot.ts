import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import OpenAI from './models/openai'

export const MOONSHOT_AI_API_HOST = 'https://api.moonshot.ai/v1'
export const MOONSHOT_CN_API_HOST = 'https://api.moonshot.cn/v1'

function createMoonshotProvider(config: {
  id: ModelProviderEnum.Moonshot | ModelProviderEnum.MoonshotCN
  name: string
  website: string
  apiHost: string
  modelsDevProviderId: string
}) {
  const provider = defineProvider({
    id: config.id,
    name: config.name,
    type: ModelProviderType.OpenAI,
    modelsDevProviderId: config.modelsDevProviderId,
    urls: {
      website: config.website,
    },
    defaultSettings: {
      apiHost: config.apiHost,
      models: [
        {
          modelId: 'kimi-k2.5',
          capabilities: ['vision'],
          contextWindow: 256_000,
          maxOutput: 8_192,
        },
        {
          modelId: 'kimi-k2-thinking',
        },
        {
          modelId: 'kimi-k2-thinking-turbo',
        },
      ],
    },
    createModel: (createConfig) => {
      return new OpenAI(
        {
          apiKey: createConfig.effectiveApiKey,
          apiHost: createConfig.formattedApiHost || config.apiHost,
          model: createConfig.model,
          dalleStyle: 'vivid',
          temperature: createConfig.settings.temperature,
          topP: createConfig.settings.topP,
          maxOutputTokens: createConfig.settings.maxTokens,
          injectDefaultMetadata: createConfig.globalSettings.injectDefaultMetadata,
          useProxy: createConfig.providerSetting.useProxy || false,
          stream: createConfig.settings.stream,
          listModelsFallback: createConfig.providerSetting.models || provider.defaultSettings?.models,
        },
        createConfig.dependencies
      )
    },
    getDisplayName: (modelId, providerSettings) => {
      return `${config.name} (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
    },
  })

  return provider
}

export const moonshotProvider = createMoonshotProvider({
  id: ModelProviderEnum.Moonshot,
  name: 'Moonshot AI',
  website: 'https://www.moonshot.ai',
  apiHost: MOONSHOT_AI_API_HOST,
  modelsDevProviderId: 'moonshotai',
})

export const moonshotCnProvider = createMoonshotProvider({
  id: ModelProviderEnum.MoonshotCN,
  name: 'Moonshot CN',
  website: 'https://www.moonshot.cn',
  apiHost: MOONSHOT_CN_API_HOST,
  modelsDevProviderId: 'moonshotai',
})
