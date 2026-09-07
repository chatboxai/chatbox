import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import TencentHunyuan from './models/tencent-hunyuan'

const HUNYUAN_API_HOST = 'https://api.hunyuan.cloud.tencent.com/v1'

export const tencentHunyuanProvider = defineProvider({
  id: ModelProviderEnum.TencentHunyuan,
  name: 'Tencent Hunyuan',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://cloud.tencent.com/product/hunyuan',
    apiKey: 'https://console.cloud.tencent.com/hunyuan/api-key',
    docs: 'https://cloud.tencent.com/document/product/1729/116755',
  },
  defaultSettings: {
    apiHost: HUNYUAN_API_HOST,
    models: [
      {
        modelId: 'hunyuan-turbos-latest',
        nickname: 'Hunyuan TurboS Latest',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 256_000,
        maxOutput: 32_000,
      },
      {
        modelId: 'hunyuan-a13b',
        nickname: 'Hunyuan A13B',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 224_000,
        maxOutput: 32_000,
      },
      {
        modelId: 'hunyuan-vision-1.5-instruct',
        nickname: 'Hunyuan Vision 1.5 Instruct',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 24_000,
        maxOutput: 16_000,
      },
      {
        modelId: 'hunyuan-t1-vision-20250916',
        nickname: 'Hunyuan T1 Vision',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 28_000,
        maxOutput: 20_000,
      },
      {
        modelId: 'hunyuan-lite',
        nickname: 'Hunyuan Lite',
        capabilities: ['tool_use'],
        contextWindow: 256_000,
        maxOutput: 4_096,
      },
      {
        modelId: 'hunyuan-role-latest',
        nickname: 'Hunyuan Role Latest',
        capabilities: [],
        contextWindow: 28_000,
        maxOutput: 4_096,
      },
      {
        modelId: 'hunyuan-translation',
        nickname: 'Hunyuan Translation',
        capabilities: [],
        contextWindow: 4_096,
        maxOutput: 4_096,
      },
      {
        modelId: 'hunyuan-embedding',
        type: 'embedding',
      },
    ],
  },
  createModel: (config) => {
    return new TencentHunyuan(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || HUNYUAN_API_HOST,
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
    return `Tencent Hunyuan (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
