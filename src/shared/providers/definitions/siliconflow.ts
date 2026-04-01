import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import SiliconFlow from './models/siliconflow'

export const siliconFlowProvider = defineProvider({
  id: ModelProviderEnum.SiliconFlow,
  name: 'SiliconFlow',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'siliconflow',
  urls: {
    website: 'https://siliconflow.cn/',
  },
  defaultSettings: {
    apiHost: 'https://api.siliconflow.cn',
    models: [
      {
        modelId: 'deepseek-ai/DeepSeek-V3.2-Exp',
        capabilities: ['tool_use'],
        contextWindow: 160_000,
      },
      {
        modelId: 'deepseek-ai/DeepSeek-V3',
        capabilities: ['tool_use'],
        contextWindow: 64_000,
      },
      {
        modelId: 'deepseek-ai/DeepSeek-R1',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 64_000,
      },
      {
        modelId: 'Pro/deepseek-ai/DeepSeek-R1',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 64_000,
      },
      {
        modelId: 'Pro/deepseek-ai/DeepSeek-V3',
        capabilities: ['tool_use'],
        contextWindow: 64_000,
      },
      {
        modelId: 'Pro/deepseek-ai/DeepSeek-V3.1',
        capabilities: ['tool_use'],
        contextWindow: 160_000,
      },
      {
        modelId: 'moonshotai/Kimi-K2-Instruct-0905',
        capabilities: ['tool_use'],
        contextWindow: 256_000,
      },
      {
        modelId: 'Qwen/Qwen2.5-7B-Instruct',
        capabilities: ['tool_use'],
        contextWindow: 32_000,
      },
      {
        modelId: 'Qwen/Qwen2.5-14B-Instruct',
        capabilities: ['tool_use'],
        contextWindow: 32_000,
      },
      {
        modelId: 'Qwen/Qwen2.5-32B-Instruct',
        capabilities: ['tool_use'],
        contextWindow: 32_000,
      },
      {
        modelId: 'Qwen/Qwen2.5-72B-Instruct',
        capabilities: ['tool_use'],
        contextWindow: 32_000,
      },
      {
        modelId: 'Qwen/Qwen2.5-VL-32B-Instruct',
        capabilities: ['vision'],
        contextWindow: 128_000,
      },
      {
        modelId: 'Qwen/Qwen2.5-VL-72B-Instruct',
        capabilities: ['vision'],
        contextWindow: 128_000,
      },
      {
        modelId: 'Qwen/QVQ-72B-Preview',
        capabilities: ['vision'],
        contextWindow: 128_000,
      },
      {
        modelId: 'Qwen/QwQ-32B',
        capabilities: ['tool_use'],
        contextWindow: 32_000,
      },
      {
        modelId: 'Pro/Qwen/Qwen2.5-VL-7B-Instruct',
        capabilities: ['vision'],
        contextWindow: 32_000,
      },
      { modelId: 'BAAI/bge-m3', type: 'embedding' },
      { modelId: 'BAAI/bge-large-zh-v1.5', type: 'embedding' },
      { modelId: 'Pro/BAAI/bge-m3', type: 'embedding' },
      { modelId: 'BAAI/bge-reranker-v2-m3', type: 'rerank' },
    ],
  },
  createModel: (config) => {
    return new SiliconFlow(
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
    return `SiliconFlow API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
