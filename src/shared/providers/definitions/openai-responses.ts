import { ModelProviderEnum, ModelProviderType } from '../../types'
import { createOAuthCredentialManager, createOpenAIOAuthFetch } from '../../oauth'
import { defineProvider } from '../registry'
import OpenAIResponses from './models/openai-responses'

export const openaiResponsesProvider = defineProvider({
  id: ModelProviderEnum.OpenAIResponses,
  name: 'OpenAI (Responses)',
  type: ModelProviderType.OpenAIResponses,
  description: 'openai-responses',
  modelsDevProviderId: 'openai',
  curatedModelIds: ['gpt-5.4', 'gpt-5-mini', 'o3-pro'],
  urls: {
    website: 'https://openai.com',
    docs: 'https://platform.openai.com/docs/api-reference/responses',
  },
  defaultSettings: {
    apiHost: 'https://api.openai.com',
    apiPath: '/responses',
    // Responses API supported models - https://platform.openai.com/docs/api-reference/responses
    models: [
      {
        modelId: 'gpt-5.4',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5-mini',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'o3-pro',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 200_000,
        maxOutput: 100_000,
      },
    ],
  },
  createModel: (config) => {
    const isOAuth = config.providerSetting.activeAuthMode === 'oauth' && !!config.providerSetting.oauth?.accessToken
    const credentialManager = createOAuthCredentialManager(
      ModelProviderEnum.OpenAIResponses,
      config.providerSetting,
      config.dependencies
    )
    return new OpenAIResponses(
      {
        apiKey: isOAuth ? 'oauth-placeholder' : config.effectiveApiKey,
        apiHost: config.formattedApiHost,
        apiPath:
          config.providerSetting.apiPath ||
          config.globalSettings.providers?.[config.settings.provider!]?.apiPath ||
          '/responses',
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
        useProxy: config.providerSetting.useProxy,
        customFetch:
          isOAuth && credentialManager ? createOpenAIOAuthFetch(config.dependencies, credentialManager) : undefined,
        listModelsFallback: isOAuth
          ? config.providerSetting.models || openaiResponsesProvider.defaultSettings?.models
          : undefined,
        skipRemoteModelList: isOAuth,
        forceStatelessResponses: isOAuth,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `OpenAI Responses API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
