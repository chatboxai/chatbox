import { createBearerOAuthFetch, createOAuthCredentialManager } from '../../oauth'
import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import OpenAI from './models/openai'

export const MINIMAX_GLOBAL_API_HOST = 'https://api.minimax.io/v1'
export const MINIMAX_CN_API_HOST = 'https://api.minimaxi.com/v1'

function createMiniMaxProvider(config: {
  id: ModelProviderEnum.MiniMax | ModelProviderEnum.MiniMaxCN
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
          modelId: 'MiniMax-M2.5',
        },
        {
          modelId: 'MiniMax-M2.5-highspeed',
        },
        {
          modelId: 'MiniMax-M2.1',
        },
        {
          modelId: 'MiniMax-M2.1-highspeed',
        },
        {
          modelId: 'MiniMax-M2',
        },
      ],
    },
    createModel: (createConfig) => {
      const isOAuth =
        createConfig.providerSetting.activeAuthMode === 'oauth' && !!createConfig.providerSetting.oauth?.accessToken
      const credentialManager = createOAuthCredentialManager(
        config.id,
        createConfig.providerSetting,
        createConfig.dependencies
      )

      return new OpenAI(
        {
          apiKey: isOAuth ? 'oauth-placeholder' : createConfig.effectiveApiKey,
          apiHost: createConfig.formattedApiHost || config.apiHost,
          model: createConfig.model,
          dalleStyle: 'vivid',
          temperature: createConfig.settings.temperature,
          topP: createConfig.settings.topP,
          maxOutputTokens: createConfig.settings.maxTokens,
          injectDefaultMetadata: createConfig.globalSettings.injectDefaultMetadata,
          useProxy: createConfig.providerSetting.useProxy || false,
          stream: createConfig.settings.stream,
          customFetch:
            isOAuth && credentialManager
              ? createBearerOAuthFetch(createConfig.dependencies, credentialManager)
              : undefined,
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

export const minimaxProvider = createMiniMaxProvider({
  id: ModelProviderEnum.MiniMax,
  name: 'MiniMax Global',
  website: 'https://www.minimax.io',
  apiHost: MINIMAX_GLOBAL_API_HOST,
  modelsDevProviderId: 'minimax',
})

export const minimaxCnProvider = createMiniMaxProvider({
  id: ModelProviderEnum.MiniMaxCN,
  name: 'MiniMax CN',
  website: 'https://www.minimaxi.com',
  apiHost: MINIMAX_CN_API_HOST,
  modelsDevProviderId: 'minimax-cn',
})
