import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import LongCat from './models/longcat'

const LONGCAT_API_HOST = 'https://api.longcat.chat/openai/v1'

export const longCatProvider = defineProvider({
  id: ModelProviderEnum.LongCat,
  name: 'LongCat',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://longcat.chat/platform',
    apiKey: 'https://longcat.chat/platform/api-keys',
    docs: 'https://longcat.chat/platform/docs',
  },
  defaultSettings: {
    apiHost: LONGCAT_API_HOST,
    models: [
      {
        modelId: 'LongCat-2.0',
        nickname: 'LongCat 2.0',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
    ],
  },
  createModel: (config) => {
    return new LongCat(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || LONGCAT_API_HOST,
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
    return `LongCat (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
