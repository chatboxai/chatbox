import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import GreenPT from './models/greenpt'

export const greenPTProvider = defineProvider({
  id: ModelProviderEnum.GreenPT,
  name: 'GreenPT',
  type: ModelProviderType.OpenAI,
  description: 'OpenAI-compatible AI inference hosted in Europe on renewable-powered infrastructure.',
  curatedModelIds: ['glm-5.2', 'kimi-k2.7-code', 'gemma4', 'green-embedding'],
  urls: {
    website: 'https://greenpt.com/',
    apiKey: 'https://account.greenpt.ai/api/keys',
    docs: 'https://docs.greenpt.ai/get-started',
    models: 'https://docs.greenpt.ai/models',
  },
  defaultSettings: {
    apiHost: 'https://api.greenpt.ai/v1',
    models: [
      {
        modelId: 'glm-5.2',
        contextWindow: 1_000_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'kimi-k2.7-code',
        contextWindow: 256_000,
        maxOutput: 256_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'gemma4',
        contextWindow: 256_000,
        maxOutput: 32_000,
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'green-embedding',
        type: 'embedding',
      },
    ],
  },
  createModel: (config) => {
    return new GreenPT(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost,
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
    return `GreenPT API (${providerSettings?.models?.find((model) => model.modelId === modelId)?.nickname || modelId})`
  },
})
