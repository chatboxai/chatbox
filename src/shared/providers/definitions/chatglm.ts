import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import ChatGLM from './models/chatglm'

export const chatGLMProvider = defineProvider({
  id: ModelProviderEnum.ChatGLM6B,
  name: 'ChatGLM6B',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'zhipuai',
  defaultSettings: {
    apiHost: 'https://open.bigmodel.cn/api/paas/v4/',
    models: [
      {
        modelId: 'glm-4.5',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'glm-4.5-air',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'glm-4.5v',
        capabilities: ['reasoning', 'vision', 'tool_use'],
        contextWindow: 64_000,
      },
      {
        modelId: 'glm-4-air',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'glm-4-plus',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'glm-4-flash',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'glm-4v-plus-0111',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 16_000,
      },
      {
        modelId: 'glm-4v-flash',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 16_000,
      },
    ],
  },
  createModel: (config) => {
    return new ChatGLM(
      {
        apiKey: config.providerSetting.apiKey || '',
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
    return `ChatGLM API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
