import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import ChatGLM from './models/chatglm'

export const chatGLMProvider = defineProvider({
  id: ModelProviderEnum.ChatGLM6B,
  name: 'ChatGLM6B',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'zhipuai',
  curatedModelIds: ['glm-5.2', 'glm-5.1', 'glm-5', 'glm-5v-turbo', 'glm-4.7', 'glm-4.7-flash', 'glm-4.5'],
  defaultSettings: {
    apiHost: 'https://open.bigmodel.cn/api/paas/v4/',
    models: [
      {
        modelId: 'glm-5.2',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'glm-5.1',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 200_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'glm-5',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'glm-5v-turbo',
        capabilities: ['reasoning', 'vision', 'tool_use'],
        contextWindow: 64_000,
      },
      {
        modelId: 'glm-4.7',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 200_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'glm-4.7-flash',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
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
    ],
  },
  createModel: (config) => {
    return new ChatGLM(
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
    return `ChatGLM API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
