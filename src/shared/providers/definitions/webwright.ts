import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import WebWright from './models/webwright'

const WEBWRIGHT_API_HOST = 'https://webwright.ai/v1'

export const webwrightProvider = defineProvider({
  id: ModelProviderEnum.WebWright,
  name: 'WebWright',
  type: ModelProviderType.OpenAI,
  description:
    'WebWright is an AI API platform serving the Wren R1 models through an OpenAI-compatible endpoint.',
  urls: {
    website: 'https://webwright.ai',
    apiKey: 'https://webwright.ai/account',
    docs: 'https://webwright.ai/v1',
    models: 'https://webwright.ai/v1/models',
  },
  defaultSettings: {
    apiHost: WEBWRIGHT_API_HOST,
    models: [
      {
        modelId: 'wren-r1',
        nickname: 'Wren R1',
        contextWindow: 200_000,
      },
      {
        modelId: 'wren-r1-fast',
        nickname: 'Wren R1 (Priority)',
        contextWindow: 200_000,
      },
    ],
  },
  createModel: (config) => {
    return new WebWright(
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
    return `WebWright (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
