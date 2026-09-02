import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import VolcEngine from './models/volcengine'

export const volcEngineProvider = defineProvider({
  id: ModelProviderEnum.VolcEngine,
  name: 'VolcEngine',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://www.volcengine.com/',
  },
  defaultSettings: {
    apiHost: 'https://ark.cn-beijing.volces.com',
    apiPath: '/api/v3/chat/completions',
    models: [
      {
        modelId: 'doubao-seed-2-1-pro-260628',
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'doubao-seed-evolving',
        contextWindow: 1_000_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'deepseek-v3-250324',
        contextWindow: 64_000,
        capabilities: ['tool_use', 'reasoning'],
      },
      {
        modelId: 'deepseek-r1-250528',
        contextWindow: 16_384,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'doubao-1-5-thinking-pro-250415',
        contextWindow: 128_000,
        capabilities: ['reasoning'],
      },
      {
        modelId: 'doubao-1.5-vision-pro-250328',
        contextWindow: 128_000,
        capabilities: ['vision'],
      },
      { modelId: 'doubao-embedding-vision-251215', type: 'embedding' },
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
