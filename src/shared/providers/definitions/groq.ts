import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Groq from './models/groq'

export const groqProvider = defineProvider({
  id: ModelProviderEnum.Groq,
  name: 'Groq',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'groq',
  curatedModelIds: [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'groq/compound',
    'groq/compound-mini',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'qwen/qwen3-32b',
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
  ],
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
      {
        modelId: 'groq/compound',
        contextWindow: 131_072,
        maxOutput: 8_192,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'groq/compound-mini',
        contextWindow: 131_072,
        maxOutput: 8_192,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'meta-llama/llama-4-scout-17b-16e-instruct',
        contextWindow: 131_072,
        capabilities: ['vision', 'tool_use'],
      },
      {
        modelId: 'qwen/qwen3-32b',
        contextWindow: 131_072,
        capabilities: ['tool_use'],
      },
      {
        modelId: 'llama-3.3-70b-versatile',
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
