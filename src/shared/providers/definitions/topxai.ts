import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import TopxAI from './models/topxai'

const TOPXAI_API_HOST = 'https://ai.topxea.com/v1'

// Model ids, context windows and output limits as the live catalogue lists
// them: https://ai.topxea.com/api/pricing (read 2026-10-25).
export const topxAIProvider = defineProvider({
  id: ModelProviderEnum.TopxAI,
  name: 'TopxAI',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://ai.topxea.com',
    apiKey: 'https://ai.topxea.com/keys',
    docs: 'https://ai.topxea.com/docs',
    models: 'https://ai.topxea.com/pricing',
  },
  defaultSettings: {
    apiHost: TOPXAI_API_HOST,
    models: [
      {
        modelId: 'claude-sonnet-5-5',
        nickname: 'Claude Sonnet 5.5',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'claude-opus-5-5',
        nickname: 'Claude Opus 5.5',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'claude-fable-5-1',
        nickname: 'Claude Fable 5.1',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-6.1-sol',
        nickname: 'GPT-6.1 Sol',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-6-astra',
        nickname: 'GPT-6 Astra',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'grok-4.7',
        nickname: 'Grok 4.7',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 500_000,
      },
      {
        modelId: 'kimi-k3.1-pro',
        nickname: 'Kimi K3.1 Pro',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 131_072,
      },
      {
        modelId: 'deepseek-flash-Abliterated',
        nickname: 'DeepSeek Flash Abliterated',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 262_144,
      },
      {
        modelId: 'GLM-5.3-Abliterated',
        nickname: 'GLM-5.3-Abliterated',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 131_072,
      },
    ],
  },
  createModel: (config) => {
    return new TopxAI(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || TOPXAI_API_HOST,
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
    return `TopxAI (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
