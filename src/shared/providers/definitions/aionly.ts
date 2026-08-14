import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Aionly from './models/aionly'

export const aionlyProvider = defineProvider({
  id: ModelProviderEnum.Aionly,
  name: 'AiOnly',
  type: ModelProviderType.OpenAI,
  description: 'AiOnly 多模型中转网关，聚合 Claude/GPT/Gemini/DeepSeek/GLM/Qwen 等主流模型。',
  urls: {
    website: 'https://api.aionly.com/',
  },
  defaultSettings: {
    models: [
      {
        modelId: 'claude-opus-4-8',
        nickname: 'Claude Opus 4.8',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'claude-sonnet-5',
        nickname: 'Claude Sonnet 5',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'gpt-5.5',
        nickname: 'GPT-5.5',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'gpt-5.4',
        nickname: 'GPT-5.4',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'gemini-3.1-pro-preview',
        nickname: 'Gemini 3.1 Pro',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'gemini-2.5-pro',
        nickname: 'Gemini 2.5 Pro',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'deepseek-v4-pro',
        nickname: 'DeepSeek V4 Pro',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'glm-5.2',
        nickname: 'GLM 5.2',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'qwen3.7-plus',
        nickname: 'Qwen 3.7 Plus',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
    ],
  },
  createModel: (config) => {
    return new Aionly(
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
    return `AiOnly API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
