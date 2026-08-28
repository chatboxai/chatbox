import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import VolcEngine from './models/volcengine'

export const volcEngineProvider = defineProvider({
  id: ModelProviderEnum.VolcEngine,
  name: 'VolcEngine',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'volcengine',
  curatedModelIds: [
    'doubao-seed-2-1-pro-260628',
    'doubao-seed-2-1-turbo-260628',
    'doubao-seed-2-0-lite-260428',
    'doubao-seed-2-0-mini-260428',
    'doubao-seed-evolving',
    'deepseek-v4-pro-ga-260813',
    'deepseek-v4-flash-ga-260731',
    'glm-5-2-260617',
  ],
  urls: {
    website: 'https://www.volcengine.com/',
  },
  defaultSettings: {
    apiHost: 'https://ark.cn-beijing.volces.com',
    apiPath: '/api/v3/chat/completions',
    models: [
      {
        modelId: 'doubao-seed-2-1-pro-260628',
        nickname: 'Doubao Seed 2.1 Pro',
        contextWindow: 256_000,
        maxOutput: 256_000,
        capabilities: ['reasoning', 'tool_use', 'vision'],
      },
      {
        modelId: 'doubao-seed-2-1-turbo-260628',
        nickname: 'Doubao Seed 2.1 Turbo',
        contextWindow: 256_000,
        maxOutput: 256_000,
        capabilities: ['reasoning', 'tool_use', 'vision'],
      },
      {
        modelId: 'doubao-seed-2-0-lite-260428',
        nickname: 'Doubao Seed 2.0 Lite',
        contextWindow: 256_000,
        maxOutput: 128_000,
        capabilities: ['reasoning', 'tool_use', 'vision'],
      },
      {
        modelId: 'doubao-seed-2-0-mini-260428',
        nickname: 'Doubao Seed 2.0 Mini',
        contextWindow: 256_000,
        maxOutput: 128_000,
        capabilities: ['reasoning', 'tool_use', 'vision'],
      },
      {
        modelId: 'doubao-seed-evolving',
        nickname: 'Doubao Seed Evolving',
        contextWindow: 1_024_000,
        maxOutput: 256_000,
        capabilities: ['reasoning', 'tool_use', 'vision'],
      },
      {
        modelId: 'deepseek-v4-pro-ga-260813',
        nickname: 'DeepSeek V4 Pro',
        contextWindow: 1_024_000,
        maxOutput: 384_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'deepseek-v4-flash-ga-260731',
        nickname: 'DeepSeek V4 Flash',
        contextWindow: 1_024_000,
        maxOutput: 384_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'glm-5-2-260617',
        nickname: 'GLM 5.2',
        contextWindow: 1_024_000,
        maxOutput: 128_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      { modelId: 'doubao-embedding-text-240715', type: 'embedding' },
    ],
  },
  createModel: (config) => {
    return new VolcEngine(
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
    return `VolcEngine API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
