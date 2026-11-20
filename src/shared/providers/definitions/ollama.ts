import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Ollama from './models/ollama'

export const ollamaProvider = defineProvider({
  id: ModelProviderEnum.Ollama,
  name: 'Ollama',
  type: ModelProviderType.OpenAI,
  // The Ollama model adapter sends replayed reasoning in Ollama's `reasoning` field.
  reasoningReplay: 'plain-text',
  defaultSettings: {
    apiHost: 'http://127.0.0.1:11434',
  },
  createModel: (config) => {
    return new Ollama(
      {
        ollamaHost: config.formattedApiHost,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
        useProxy: config.providerSetting.useProxy,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `Ollama (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
