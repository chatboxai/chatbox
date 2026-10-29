import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import YApi from './models/y-api'

const Y_API_HOST = 'https://api.y-api.bestvirtualgoods.com/v1'

export const yApiProvider = defineProvider({
  id: ModelProviderEnum.YApi,
  name: 'Y-API',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://y-api.bestvirtualgoods.com',
    apiKey: 'https://y-api.bestvirtualgoods.com/app/keys',
    docs: 'https://y-api.bestvirtualgoods.com/docs',
    models: 'https://y-api.bestvirtualgoods.com/models',
  },
  defaultSettings: {
    apiHost: Y_API_HOST,
    models: [
      {
        modelId: 'deepseek/deepseek-v4-flash',
        nickname: 'DeepSeek V4 Flash',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_000_000,
        maxOutput: 384_000,
      },
      {
        modelId: 'deepseek/deepseek-v4-flash-0731',
        nickname: 'DeepSeek V4 Flash 0731',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_000_000,
        maxOutput: 384_000,
      },
      {
        modelId: 'deepseek/deepseek-v4-pro',
        nickname: 'DeepSeek V4 Pro',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_000_000,
        maxOutput: 384_000,
      },
      {
        modelId: 'deepseek/deepseek-v4.1-flash',
        nickname: 'DeepSeek V4.1 Flash',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_000_000,
        maxOutput: 384_000,
      },
      {
        modelId: 'moonshotai/kimi-k3',
        nickname: 'Kimi K3',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 1_048_576,
        maxOutput: 131_072,
      },
      {
        modelId: 'openai/gpt-5.6-luna',
        nickname: 'GPT-5.6 Luna',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'openai/gpt-5.6-sol',
        nickname: 'GPT-5.6 Sol',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'openai/gpt-5.6-terra',
        nickname: 'GPT-5.6 Terra',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'openai/gpt-6-astra',
        nickname: 'GPT-6 Astra',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'tencent/hy3',
        nickname: 'Hy3',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 256_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'xiaomi/mimo-v2.5',
        nickname: 'MiMo-V2.5',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 1_048_576,
        maxOutput: 131_072,
      },
      {
        modelId: 'z-ai/glm-5.2',
        nickname: 'GLM-5.2',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_000_000,
        maxOutput: 131_072,
      },
      {
        modelId: 'z-ai/glm-5.3',
        nickname: 'GLM-5.3',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_000_000,
        maxOutput: 131_072,
      },
      {
        modelId: 'z-ai/glm-5.3-flash',
        nickname: 'GLM-5.3 Flash',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_000_000,
        maxOutput: 131_072,
      },
    ],
  },
  createModel: (config) => {
    return new YApi(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || Y_API_HOST,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        useProxy: config.providerSetting.useProxy,
        stream: config.settings.stream,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `Y-API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
