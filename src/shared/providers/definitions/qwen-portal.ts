import { createBearerOAuthFetch, createOAuthCredentialManager } from '../../oauth'
import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import OpenAI from './models/openai'

export const QWEN_PORTAL_API_HOST = 'https://portal.qwen.ai/v1'

export const qwenPortalProvider = defineProvider({
  id: ModelProviderEnum.QwenPortal,
  name: 'Qwen Portal',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'alibaba',
  curatedModelIds: ['coder-model', 'vision-model'],
  urls: {
    website: 'https://chat.qwen.ai',
    docs: 'https://qwenlm.github.io/qwen-code-docs/en/users/overview/',
  },
  defaultSettings: {
    activeAuthMode: 'oauth',
    apiHost: QWEN_PORTAL_API_HOST,
    models: [
      {
        modelId: 'coder-model',
        nickname: 'Qwen Coder',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
        maxOutput: 8_192,
      },
      {
        modelId: 'vision-model',
        nickname: 'Qwen Vision',
        capabilities: ['vision'],
        contextWindow: 128_000,
        maxOutput: 8_192,
      },
    ],
  },
  createModel: (config) => {
    const isOAuth = config.providerSetting.activeAuthMode === 'oauth' && !!config.providerSetting.oauth?.accessToken
    const credentialManager = createOAuthCredentialManager(
      ModelProviderEnum.QwenPortal,
      config.providerSetting,
      config.dependencies
    )

    return new OpenAI(
      {
        apiKey: isOAuth ? 'oauth-placeholder' : config.effectiveApiKey,
        apiHost: config.formattedApiHost || QWEN_PORTAL_API_HOST,
        model: config.model,
        dalleStyle: 'vivid',
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        injectDefaultMetadata: config.globalSettings.injectDefaultMetadata,
        useProxy: config.providerSetting.useProxy || false,
        stream: config.settings.stream,
        customFetch:
          isOAuth && credentialManager ? createBearerOAuthFetch(config.dependencies, credentialManager) : undefined,
        listModelsFallback: config.providerSetting.models || qwenPortalProvider.defaultSettings?.models,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `Qwen Portal (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
