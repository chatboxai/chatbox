import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Ionet from './models/ionet'

const IONET_API_HOST = 'https://api.intelligence.io.solutions/api/v1'

export const ionetProvider = defineProvider({
  id: ModelProviderEnum.Ionet,
  name: 'IO Intelligence',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://io.net/',
    apiKey: 'https://cloud.io.net/',
    docs: 'https://io.net/docs/reference/ai-models/get-started-with-io-intelligence-api',
  },
  defaultSettings: {
    apiHost: IONET_API_HOST,
    models: [
      {
        modelId: 'deepseek-ai/DeepSeek-V4.1-Flash',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 262_124,
        maxOutput: 131_072,
      },
      {
        modelId: 'zai-org/GLM-5.3',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 262_144,
        maxOutput: 131_072,
      },
      {
        modelId: 'zai-org/GLM-5.3-Flash',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 262_144,
        maxOutput: 131_072,
      },
      {
        modelId: 'deepseek-ai/DeepSeek-V4-Pro',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 600_000,
      },
      {
        modelId: 'moonshotai/Kimi-K3',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
      },
      {
        modelId: 'Qwen/Qwen3.8-27B',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 65_536,
        maxOutput: 65_536,
      },
      {
        modelId: 'MiniMaxAI/MiniMax-M2.7',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 262_100,
        maxOutput: 65_536,
      },
      {
        modelId: 'openai/gpt-oss-120b',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 131_072,
      },
      {
        modelId: 'deepseek-ai/DeepSeek-R1-0528',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'meta-llama/Llama-3.3-70B-Instruct',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
    ],
  },
  createModel: (config) => {
    return new Ionet(
      {
        apiKey: config.effectiveApiKey,
        apiHost: (config.formattedApiHost || IONET_API_HOST).replace(/\/+$/, ''),
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
        useProxy: config.providerSetting.useProxy || false,
        listModelsFallback: config.providerSetting.models || ionetProvider.defaultSettings?.models,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `IO Intelligence (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
