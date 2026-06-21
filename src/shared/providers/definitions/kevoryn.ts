// 文件: src/shared/providers/definitions/kevoryn.ts
import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import KevorynModel from './models/kevoryn'

export const kevorynProvider = defineProvider({
  id: ModelProviderEnum.Kevoryn,
  name: 'Kevoryn',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'kevoryn',
  curatedModelIds: [
    'claude-sonnet-4-6',
    'claude-opus-4-8',
    'gpt-5.5',
    'deepseek-v4-pro',
    'gemini-3.1-pro-preview',
    'claude-haiku-4-5',
  ],
  urls: {
    website: 'https://kevoryn.com',
    docs: 'https://kevoryn.com',
  },
  defaultSettings: {
    models: [
      { modelId: 'claude-sonnet-4-6', contextWindow: 200_000, capabilities: ['vision', 'tool_use', 'reasoning'] },
      { modelId: 'claude-opus-4-8', contextWindow: 200_000, capabilities: ['vision', 'tool_use', 'reasoning'] },
      { modelId: 'gpt-5.5', contextWindow: 256_000, capabilities: ['vision', 'tool_use', 'reasoning'] },
      { modelId: 'deepseek-v4-pro', contextWindow: 1_000_000, capabilities: ['tool_use'] },
      { modelId: 'gemini-3.1-pro-preview', contextWindow: 1_000_000, capabilities: ['vision', 'tool_use', 'reasoning'] },
      { modelId: 'claude-haiku-4-5', contextWindow: 200_000, capabilities: ['vision', 'tool_use'] },
    ],
  },
  createModel: (config) => {
    return new KevorynModel(
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
  getDisplayName: (modelId) => `Kevoryn (${modelId})`,
})
