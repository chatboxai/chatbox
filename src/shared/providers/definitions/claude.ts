import { createBearerOAuthFetch, createOAuthCredentialManager } from '../../oauth'
import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Claude from './models/claude'

export const claudeProvider = defineProvider({
  id: ModelProviderEnum.Claude,
  name: 'Claude',
  type: ModelProviderType.Claude,
  modelsDevProviderId: 'anthropic',
  curatedModelIds: [
    'claude-fable-5',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
  ],
  urls: {
    website: 'https://www.anthropic.com',
  },
  defaultSettings: {
    apiHost: 'https://api.anthropic.com/v1',
    // https://docs.anthropic.com/en/docs/about-claude/models/overview
    models: [
      {
        modelId: 'claude-fable-5',
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'claude-opus-5',
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'claude-sonnet-5',
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'claude-opus-4-8',
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'claude-opus-4-7',
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'claude-opus-4-6',
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'claude-sonnet-4-6',
        contextWindow: 1_000_000,
        maxOutput: 64_000,
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'claude-sonnet-4-5',
        contextWindow: 200_000,
        maxOutput: 64_000,
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'claude-haiku-4-5',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 200_000,
        maxOutput: 64_000,
      },
    ],
  },
  createModel: (config) => {
    // Anthropic OAuth tokens (sk-ant-oat-*) require Bearer auth + beta header + system passphrase
    const isOAuth = config.providerSetting.activeAuthMode === 'oauth' && !!config.providerSetting.oauth?.accessToken
    const credentialManager = createOAuthCredentialManager(
      ModelProviderEnum.Claude,
      config.providerSetting,
      config.dependencies
    )
    const oauthHeaders: Record<string, string> = isOAuth
      ? {
          'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
        }
      : {}

    return new Claude(
      {
        claudeApiKey: isOAuth ? '' : config.effectiveApiKey,
        claudeApiHost: config.formattedApiHost,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
        extraHeaders: oauthHeaders,
        customFetch:
          isOAuth && credentialManager ? createBearerOAuthFetch(config.dependencies, credentialManager) : undefined,
        // OAuth uses SDK's built-in authToken for Bearer auth instead of apiKey
        authToken: isOAuth ? config.effectiveApiKey : undefined,
        isOAuth,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `Claude API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
