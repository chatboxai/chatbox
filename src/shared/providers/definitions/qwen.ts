import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import OpenAI from './models/openai'

const QWEN_API_HOST = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

export const qwenProvider = defineProvider({
  id: ModelProviderEnum.Qwen,
  name: 'Qwen',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'alibaba',
  urls: {
    website: 'https://chat.qwen.ai',
    docs: 'https://qwenlm.github.io/qwen-code-docs/en/users/overview/',
  },
  defaultSettings: {
    apiHost: QWEN_API_HOST,
    models: [
      {
        modelId: 'qwen3.5-plus',
      },
      {
        modelId: 'qwen3-coder-plus',
        capabilities: ['tool_use'],
      },
      {
        modelId: 'qwen3-max-2026-01-23',
      },
    ],
  },
  createModel: (config) => {
    return new OpenAI(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || QWEN_API_HOST,
        model: config.model,
        dalleStyle: 'vivid',
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        injectDefaultMetadata: config.globalSettings.injectDefaultMetadata,
        useProxy: config.providerSetting.useProxy || false,
        stream: config.settings.stream,
        listModelsFallback: config.providerSetting.models || qwenProvider.defaultSettings?.models,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `Qwen (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
