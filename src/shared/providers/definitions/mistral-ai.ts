import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import MistralAI from './models/mistral-ai'

export const mistralAIProvider = defineProvider({
  id: ModelProviderEnum.MistralAI,
  name: 'Mistral AI',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'mistral',
  curatedModelIds: [
    'mistral-medium-3-5',
    'mistral-small-2603',
    'mistral-large-2512',
    'pixtral-large-latest',
    'codestral-latest',
    'mistral-embed',
  ],
  urls: {
    website: 'https://mistral.ai',
  },
  defaultSettings: {
    apiHost: 'https://api.mistral.ai/v1',
    models: [
      {
        modelId: 'mistral-medium-3-5',
        nickname: 'Mistral Medium 3.5',
        contextWindow: 256_000,
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'mistral-small-2603',
        nickname: 'Mistral Small 4',
        contextWindow: 256_000,
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'mistral-large-2512',
        nickname: 'Mistral Large 3',
        contextWindow: 256_000,
        capabilities: ['vision', 'tool_use'],
      },
      {
        modelId: 'pixtral-large-latest',
        contextWindow: 128_000,
        capabilities: ['vision', 'tool_use'],
      },
      {
        modelId: 'codestral-latest',
        contextWindow: 32_000,
        capabilities: [],
      },
      {
        modelId: 'mistral-embed',
        type: 'embedding',
      },
    ],
  },
  createModel: (config) => {
    return new MistralAI(
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
    return `MistralAI (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
