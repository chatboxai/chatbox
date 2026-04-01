import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Groq from './models/groq'

export const groqProvider = defineProvider({
  id: ModelProviderEnum.Groq,
  name: 'Groq',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'groq',
  curatedModelIds: [
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'llama-3.3-70b-versatile',
    'moonshotai/kimi-k2-instruct-0905',
    'qwen/qwen3-32b',
    'llama-3.1-8b-instant',
  ],
  urls: {
    website: 'https://groq.com/',
  },
  defaultSettings: {
    apiHost: 'https://api.groq.com/openai',
    models: [
      {
        modelId: 'meta-llama/llama-4-scout-17b-16e-instruct',
        contextWindow: 131_072,
        capabilities: ['vision', 'tool_use'],
      },
      {
        modelId: 'meta-llama/llama-4-maverick-17b-128e-instruct',
        contextWindow: 131_072,
        capabilities: ['vision', 'tool_use'],
      },
      {
        modelId: 'llama-3.3-70b-versatile',
        contextWindow: 131_072,
        capabilities: ['tool_use'],
      },
      {
        modelId: 'moonshotai/kimi-k2-instruct-0905',
        contextWindow: 262_144,
        capabilities: ['tool_use'],
      },
      {
        modelId: 'qwen/qwen3-32b',
        contextWindow: 131_072,
        capabilities: ['tool_use'],
      },
      {
        modelId: 'llama-3.1-8b-instant',
        contextWindow: 131_072,
        capabilities: ['tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new Groq(
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
    return `Groq API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
