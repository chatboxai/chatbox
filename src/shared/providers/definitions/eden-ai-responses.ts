import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import EdenAIResponses from './models/eden-ai-responses'

// Eden AI Responses API: a stateful, OpenAI-compatible alternative to chat
// completions that stores conversation history server-side.
// Docs: https://www.edenai.co/docs/api-reference/responses/create-response
export const edenAIResponsesProvider = defineProvider({
  id: ModelProviderEnum.EdenAIResponses,
  name: 'Eden AI (Responses)',
  type: ModelProviderType.OpenAIResponses,
  description: 'eden-ai-responses',
  curatedModelIds: ['@edenai', 'openai/gpt-4o', 'anthropic/claude-sonnet-4-5'],
  urls: {
    website: 'https://www.edenai.co/',
    apiKey: 'https://app.edenai.run/admin/api-settings/features-preferences',
    docs: 'https://www.edenai.co/docs/api-reference/responses/create-response',
  },
  defaultSettings: {
    apiHost: 'https://api.edenai.run/v3',
    apiPath: '/responses',
    models: [
      {
        modelId: '@edenai',
        nickname: 'Eden AI (auto-router)',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'openai/gpt-4o',
        nickname: 'GPT-4o',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 128_000,
        maxOutput: 16_384,
      },
      {
        modelId: 'anthropic/claude-sonnet-4-5',
        nickname: 'Claude Sonnet 4.5',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 200_000,
        maxOutput: 64_000,
      },
    ],
  },
  createModel: (config) => {
    return new EdenAIResponses(
      {
        apiKey: config.providerSetting.apiKey || '',
        apiHost: config.formattedApiHost || 'https://api.edenai.run/v3',
        apiPath: config.formattedApiPath || '/responses',
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
        useProxy: config.providerSetting.useProxy,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `Eden AI Responses (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
