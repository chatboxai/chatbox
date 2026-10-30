import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import PowerTokens from './models/powertokens'

const POWERTOKENS_API_HOST = 'https://api.powertokens.ai/v1'

export const powerTokensProvider = defineProvider({
  id: ModelProviderEnum.PowerTokens,
  name: 'PowerTokens',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://powertokens.ai',
    apiKey: 'https://powertokens.ai/api-keys',
    docs: 'https://docs.powertokens.ai',
  },
  defaultSettings: {
    apiHost: POWERTOKENS_API_HOST,
    models: [
      {
        modelId: 'glm-5.2',
        nickname: 'GLM-5.2',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 131_072,
      },
      {
        modelId: 'glm-5.3',
        nickname: 'GLM-5.3',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 131_072,
      },
      {
        modelId: 'glm-5-turbo',
        nickname: 'GLM-5-Turbo',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 200_000,
        maxOutput: 131_072,
      },
      {
        modelId: 'MiniMax-M3',
        nickname: 'MiniMax-M3',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 131_072,
      },
      {
        modelId: 'qwen3-coder-plus',
        nickname: 'Qwen3 Coder Plus',
        capabilities: ['tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'qwen3-max',
        nickname: 'Qwen3 Max',
        capabilities: ['tool_use'],
        contextWindow: 262_144,
        maxOutput: 65_536,
      },
      {
        modelId: 'deepseek-v3-2-251201',
        nickname: 'DeepSeek V3.2',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 128_000,
        maxOutput: 32_768,
      },
    ],
  },
  createModel: (config) => {
    return new PowerTokens(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || POWERTOKENS_API_HOST,
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
    return `PowerTokens (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
