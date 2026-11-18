import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Wally from './models/wally'

const WALLY_API_HOST = 'https://inference.runanywhere.ai/v1'

export const wallyProvider = defineProvider({
  id: ModelProviderEnum.Wally,
  name: 'Wally',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://www.runwally.com',
    apiKey: 'https://console.runanywhere.ai',
    docs: 'https://docs.runanywhere.ai/wally-cloud/api',
  },
  defaultSettings: {
    apiHost: WALLY_API_HOST,
    models: [
      {
        modelId: 'deepseek-v4.1-flash',
        nickname: 'DeepSeek V4.1 Flash',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'glm-5.3-flash',
        nickname: 'GLM-5.3 Flash',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 131_072,
      },
      {
        modelId: 'kimi-k3',
        nickname: 'Kimi K3',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'glm-5.3-fast',
        nickname: 'GLM-5.3 (Fast)',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 131_072,
      },
      {
        modelId: 'deepseek-v4-pro-fast',
        nickname: 'DeepSeek V4 Pro (Fast)',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'minimax-m3',
        nickname: 'MiniMax M3',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 524_287,
        maxOutput: 131_072,
      },
    ],
  },
  createModel: (config) => {
    return new Wally(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || WALLY_API_HOST,
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
    return `Wally (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
