import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import AtlasCloud from './models/atlascloud'

export const atlasCloudProvider = defineProvider({
  id: ModelProviderEnum.AtlasCloud,
  name: 'Atlas Cloud',
  type: ModelProviderType.OpenAI,
  description: 'OpenAI-compatible gateway to 300+ models — OpenAI, Anthropic, DeepSeek, Qwen, GLM, Kimi, and more.',
  urls: {
    website: 'https://www.atlascloud.ai/',
    apiKey: 'https://www.atlascloud.ai/',
    docs: 'https://docs.atlascloud.ai/',
  },
  defaultSettings: {
    apiHost: 'https://api.atlascloud.ai',
    models: [
      {
        modelId: 'openai/gpt-4.1-mini',
        contextWindow: 1_047_576,
        maxOutput: 32_768,
        capabilities: ['tool_use'],
      },
      {
        modelId: 'openai/gpt-5.4-mini',
        contextWindow: 400_000,
        maxOutput: 131_072,
        capabilities: ['tool_use'],
      },
      {
        modelId: 'anthropic/claude-sonnet-4.6',
        contextWindow: 200_000,
        maxOutput: 64_000,
        capabilities: ['tool_use'],
      },
      {
        modelId: 'deepseek-ai/deepseek-v3.2',
        contextWindow: 163_840,
        maxOutput: 163_840,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
        contextWindow: 131_072,
        maxOutput: 131_072,
        capabilities: ['tool_use'],
      },
      {
        modelId: 'qwen/qwen3.5-35b-a3b',
        contextWindow: 262_144,
        maxOutput: 65_536,
        capabilities: ['reasoning', 'vision', 'tool_use'],
      },
      {
        modelId: 'zai-org/GLM-4.6',
        contextWindow: 202_752,
        maxOutput: 202_752,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'moonshotai/kimi-k2.5',
        contextWindow: 262_144,
        maxOutput: 262_144,
        capabilities: ['reasoning', 'vision', 'tool_use'],
      },
      {
        modelId: 'minimaxai/minimax-m2.5',
        contextWindow: 196_608,
        maxOutput: 196_608,
        capabilities: ['reasoning', 'tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new AtlasCloud(
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
    return `Atlas Cloud (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
