import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import LMStudio from './models/lmstudio'

export const lmStudioProvider = defineProvider({
  id: ModelProviderEnum.LMStudio,
  name: 'LM Studio',
  type: ModelProviderType.OpenAI,
  defaultSettings: {
    apiHost: 'http://127.0.0.1:1234',
  },
  createModel: (config) => {
    return new LMStudio(
      {
        apiHost: config.formattedApiHost,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
        // On mobile, this selects the native HTTP transport. It is required for
        // direct LAN access (and lets iOS present its local-network prompt).
        useProxy: config.dependencies.platformType === 'mobile' || config.providerSetting.useProxy,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `LM Studio API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
