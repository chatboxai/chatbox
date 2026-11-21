import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import CrowLLM from './models/crowllm'

export const crowllmProvider = defineProvider({
  id: ModelProviderEnum.CrowLLM,
  name: 'CrowLLM',
  type: ModelProviderType.OpenAI,
  description:
    'OpenAI-compatible gateway with one key for every model, plus a zero-rated free model shelf.',
  urls: {
    website: 'https://crowllm.com',
    apiKey: 'https://crowllm.com',
    docs: 'https://crowllm.com/docs',
  },
  defaultSettings: {
    apiHost: 'https://crowllm.com/v1',
    models: [
      {
        modelId: 'deepseek-v4-flash',
        nickname: 'DeepSeek V4 Flash',
        contextWindow: 128_000,
        capabilities: ['tool_use'],
      },
      {
        modelId: 'glm-5.3',
        nickname: 'GLM 5.3',
        contextWindow: 200_000,
        capabilities: ['tool_use', 'reasoning'],
      },
      {
        modelId: 'kimi-k3',
        nickname: 'Kimi K3',
        contextWindow: 256_000,
        capabilities: ['tool_use'],
      },
      {
        modelId: 'claude-opus-4-7',
        nickname: 'Claude Opus 4.7',
        contextWindow: 200_000,
        capabilities: ['vision', 'tool_use', 'reasoning'],
      },
      {
        modelId: 'gemini-3.7-flash',
        nickname: 'Gemini 3.7 Flash',
        contextWindow: 1_000_000,
        capabilities: ['vision', 'tool_use'],
      },
      {
        modelId: 'qwen-3.8-27b:free',
        nickname: 'Qwen 3.8 27B (free)',
        contextWindow: 131_072,
        capabilities: ['tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new CrowLLM(
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
})
