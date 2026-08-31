import { ModelProviderEnum, ModelProviderType } from '../../types'
import type { ProviderModelInfo } from '../../types/settings'
import { defineProvider } from '../registry'
import Llmman from './models/llmman'

export const llmmanProvider = defineProvider({
  id: ModelProviderEnum.Llmman,
  name: 'llmman',
  type: ModelProviderType.OpenAI,
  defaultSettings: {
    apiHost: 'http://127.0.0.1:17434',
  },
  createModel: (config) => {
    return new Llmman(
      {
        apiHost: config.formattedApiHost,
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
    return `llmman API (${providerSettings?.models?.find((m: ProviderModelInfo) => m.modelId === modelId)?.nickname || modelId})`
  },
})
