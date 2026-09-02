import { createOAuthCredentialManager, createOpenAIOAuthFetch } from '../../oauth'
import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import OpenAI from './models/openai'
import OpenAIResponses from './models/openai-responses'

export const openaiProvider = defineProvider({
  id: ModelProviderEnum.OpenAI,
  name: 'OpenAI',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'openai',
  curatedModelIds: [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.2',
    'gpt-5.2-pro',
    'o4-mini',
    'o3-pro',
    'o3-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
    'gpt-4o-mini',
    'text-embedding-3-small',
    'text-embedding-3-large',
  ],
  urls: {
    website: 'https://openai.com',
  },
  defaultSettings: {
    apiHost: 'https://api.openai.com',
    // https://platform.openai.com/docs/models
    models: [
      {
        modelId: 'gpt-5.6-sol',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.6-terra',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.6-luna',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.4',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.4-mini',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.4-nano',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.2',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.2-pro',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'o4-mini',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 200_000,
        maxOutput: 100_000,
      },
      {
        modelId: 'o3-pro',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 200_000,
        maxOutput: 100_000,
      },
      {
        modelId: 'o3-mini',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 200_000,
        maxOutput: 100_000,
      },
      {
        modelId: 'gpt-4.1',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 1_047_576,
        maxOutput: 32_768,
      },
      {
        modelId: 'gpt-4.1-mini',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 1_047_576,
        maxOutput: 32_768,
      },
      {
        modelId: 'gpt-4o',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 128_000,
        maxOutput: 16_384,
      },
      {
        modelId: 'gpt-4o-mini',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 128_000,
        maxOutput: 16_384,
      },
      {
        modelId: 'text-embedding-3-small',
        type: 'embedding',
      },
      {
        modelId: 'text-embedding-3-large',
        type: 'embedding',
      },
    ],
  },
  createModel: (config) => {
    const isOAuth = config.providerSetting.activeAuthMode === 'oauth' && !!config.providerSetting.oauth?.accessToken
    const credentialManager = createOAuthCredentialManager(
      ModelProviderEnum.OpenAI,
      config.providerSetting,
      config.dependencies
    )
    const oauthFetch =
      isOAuth && credentialManager ? createOpenAIOAuthFetch(config.dependencies, credentialManager) : undefined

    if (isOAuth) {
      return new OpenAIResponses(
        {
          apiKey: 'oauth-placeholder',
          apiHost: config.formattedApiHost,
          apiPath: '/responses',
          model: config.model,
          temperature: config.settings.temperature,
          topP: config.settings.topP,
          maxOutputTokens: config.settings.maxTokens,
          stream: config.settings.stream,
          useProxy: false,
          customFetch: oauthFetch,
          listModelsFallback: config.providerSetting.models || openaiProvider.defaultSettings?.models,
          skipRemoteModelList: true,
        },
        config.dependencies
      )
    }

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
  getDisplayName: (modelId, providerSettings, sessionType) => {
    if (sessionType === 'picture') {
      return 'OpenAI API (DALL-E-3)'
    }
    return `OpenAI API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
