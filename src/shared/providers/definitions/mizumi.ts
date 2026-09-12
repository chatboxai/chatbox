import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Mizumi from './models/mizumi'

const MIZUMI_API_HOST = 'https://api.mizumi.co'

export const mizumiProvider = defineProvider({
  id: ModelProviderEnum.Mizumi,
  name: 'Mizumi',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://mizumi.co/',
    docs: 'https://mizumi.co/docs',
  },
  defaultSettings: {
    apiHost: MIZUMI_API_HOST,
    models: [
      { modelId: 'gpt-5.6-sol', capabilities: ['tool_use'] },
      { modelId: 'gpt-5.6-terra', capabilities: ['tool_use'] },
      { modelId: 'gpt-5.6-luna', capabilities: ['tool_use'] },
      { modelId: 'gpt-5.5', capabilities: ['tool_use'] },
      { modelId: 'gpt-5.4', capabilities: ['tool_use'] },
      { modelId: 'gpt-4.1-mini', capabilities: ['tool_use'] },
    ],
  },
  createModel: (config) => {
    return new Mizumi(
      {
        apiKey: config.providerSetting.apiKey || '',
        apiHost: config.formattedApiHost || MIZUMI_API_HOST,
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
    return `Mizumi (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
