import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import EdenAI from './models/eden-ai'

// Eden AI exposes an OpenAI-compatible Chat Completions endpoint that routes to
// 100+ models from many providers. Model ids use the `provider/model` format,
// e.g. `openai/gpt-4o`. The special `@edenai` id auto-routes to the best model.
// Docs: https://www.edenai.co/docs/api-reference/chat/chat-completions
export const edenAIProvider = defineProvider({
  id: ModelProviderEnum.EdenAI,
  name: 'Eden AI',
  type: ModelProviderType.OpenAI,
  description: 'eden-ai',
  curatedModelIds: [
    '@edenai',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'anthropic/claude-sonnet-4-5',
    'google/gemini-2.5-pro',
    'mistral/mistral-large-latest',
  ],
  urls: {
    website: 'https://www.edenai.co/',
    apiKey: 'https://app.edenai.run/admin/api-settings/features-preferences',
    docs: 'https://www.edenai.co/docs/api-reference/chat/chat-completions',
  },
  defaultSettings: {
    apiHost: 'https://api.edenai.run/v3',
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
        modelId: 'openai/gpt-4o-mini',
        nickname: 'GPT-4o mini',
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
      {
        modelId: 'google/gemini-2.5-pro',
        nickname: 'Gemini 2.5 Pro',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'mistral/mistral-large-latest',
        nickname: 'Mistral Large',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
        maxOutput: 8_192,
      },
    ],
  },
  createModel: (config) => {
    return new EdenAI(
      {
        apiKey: config.providerSetting.apiKey || '',
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
    return `Eden AI (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
