import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import XiaomiMiMo from './models/xiaomi-mimo'

const XIAOMI_MIMO_API_HOST = 'https://api.xiaomimimo.com/v1'

export const xiaomiMiMoProvider = defineProvider({
  id: ModelProviderEnum.XiaomiMiMo,
  name: 'Xiaomi MiMo',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://mimo.mi.com/',
    apiKey: 'https://mimo.mi.com/keys',
    docs: 'https://mimo.mi.com/docs/zh-CN/tokenplan/integration/tools-overview',
  },
  defaultSettings: {
    apiHost: XIAOMI_MIMO_API_HOST,
    models: [
      {
        modelId: 'mimo-v2.5-pro',
        nickname: 'MiMo-V2.5-Pro',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'mimo-v2.5',
        nickname: 'MiMo-V2.5',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
    ],
  },
  createModel: (config) => {
    return new XiaomiMiMo(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || XIAOMI_MIMO_API_HOST,
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
    return `Xiaomi MiMo (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
