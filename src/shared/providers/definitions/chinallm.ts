import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import ChinaLLMModel from './models/chinallm'

export const chinallmProvider = defineProvider({
  id: ModelProviderEnum.ChinaLLM,
  name: 'ChinaLLM',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'chinallm',
  curatedModelIds: ['deepseek-chat', 'deepseek-reasoner', 'qwen-plus', 'qwen-max', 'glm-4-flash'],
  urls: {
    website: 'https://chinallm.dev',
  },
  defaultSettings: {
    models: [
      {
        modelId: 'deepseek-chat',
        contextWindow: 65536,
        capabilities: ['tool_use'],
      },
      {
        modelId: 'deepseek-reasoner',
        contextWindow: 65536,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'qwen-plus',
        contextWindow: 131072,
        capabilities: ['vision'],
      },
      {
        modelId: 'qwen-max',
        contextWindow: 32768,
        capabilities: ['vision', 'tool_use'],
      },
      {
        modelId: 'glm-4-flash',
        contextWindow: 128000,
        capabilities: ['tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new ChinaLLMModel(
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
    return `ChinaLLM (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
