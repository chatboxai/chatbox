import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Groq from './models/groq'

export const groqProvider = defineProvider({
  id: ModelProviderEnum.Groq,
  name: 'Groq',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'groq',
  curatedModelIds: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  urls: {
    website: 'https://groq.com/',
  },
  defaultSettings: {
    apiHost: 'https://api.groq.com/openai',
    models: [
      {
        modelId: 'openai/gpt-oss-120b',
        contextWindow: 131_072,
        maxOutput: 65_536,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'openai/gpt-oss-20b',
        contextWindow: 131_072,
        maxOutput: 65_536,
        capabilities: ['reasoning', 'tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new Groq(
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
    return `Groq API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
