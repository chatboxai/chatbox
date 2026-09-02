import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import ZhipuGLMCodingPlan from './models/zhipu-glm-coding-plan'

const GLM_CODING_PLAN_API_HOST = 'https://open.bigmodel.cn/api/coding/paas/v4'

export const zhipuGLMCodingPlanProvider = defineProvider({
  id: ModelProviderEnum.ZhipuGLMCodingPlan,
  name: 'GLM Coding Plan',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://bigmodel.cn/coding-plan',
    apiKey: 'https://bigmodel.cn/coding-plan/personal/overview',
    docs: 'https://docs.bigmodel.cn/cn/coding-plan/tool/others',
  },
  defaultSettings: {
    apiHost: GLM_CODING_PLAN_API_HOST,
    apiPath: '/chat/completions',
    models: [
      {
        modelId: 'glm-5.3',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'glm-5-turbo',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 200_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'glm-4.7',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 200_000,
        maxOutput: 128_000,
      },
    ],
  },
  createModel: (config) => {
    return new ZhipuGLMCodingPlan(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || GLM_CODING_PLAN_API_HOST,
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
    return `GLM Coding Plan (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
