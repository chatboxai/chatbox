import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Kevoryn from './models/kevoryn'

export const kevorynProvider = defineProvider({
  id: ModelProviderEnum.Kevoryn,
  name: 'Kevoryn',
  type: ModelProviderType.OpenAI,
  description: 'AI API Gateway — 66+ frontier models (GPT, Claude, Gemini, DeepSeek, Kimi, Qwen) through a single endpoint.',
  urls: {
    website: 'https://kevoryn.com/',
    docs: 'https://kevoryn.com/docs',
    models: 'https://kevoryn.com/models',
  },
  defaultSettings: {
    apiHost: 'https://api.kevoryn.com/v1',
    models: [
      {
        modelId: 'claude-opus-4-8',
        nickname: 'Claude Opus 4.8',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 200_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'claude-sonnet-4-6',
        nickname: 'Claude Sonnet 4.6',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 200_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'claude-haiku-4-5',
        nickname: 'Claude Haiku 4.5',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 200_000,
        maxOutput: 8_192,
      },
      {
        modelId: 'gpt-5.5',
        nickname: 'GPT-5.5',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.4',
        nickname: 'GPT-5.4',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-5.4-mini',
        nickname: 'GPT-5.4 Mini',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gemini-3.1-pro-preview',
        nickname: 'Gemini 3.1 Pro',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'deepseek-v4-pro',
        nickname: 'DeepSeek V4 Pro',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 163_840,
        maxOutput: 163_840,
      },
      {
        modelId: 'deepseek-v4-flash',
        nickname: 'DeepSeek V4 Flash',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
        maxOutput: 32_768,
      },
      {
        modelId: 'kimi-k2.6',
        nickname: 'Kimi K2.6',
        capabilities: ['tool_use'],
        contextWindow: 131_072,
        maxOutput: 32_768,
      },
      {
        modelId: 'qwen3.6-plus',
        nickname: 'Qwen 3.6 Plus',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 128_000,
        maxOutput: 32_768,
      },
      {
        modelId: 'qwen3-coder-plus',
        nickname: 'Qwen3 Coder Plus',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 128_000,
        maxOutput: 32_768,
      },
      {
        modelId: 'glm-5.1',
        nickname: 'GLM 5.1',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 128_000,
        maxOutput: 32_768,
      },
      {
        modelId: 'MiniMax-M2.7',
        nickname: 'MiniMax M2.7',
        capabilities: ['tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'grok-4.20',
        nickname: 'Grok 4.20',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 256_000,
        maxOutput: 64_000,
      },
    ],
  },
  createModel: (config) => {
    return new Kevoryn(
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
    return `Kevoryn API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
