import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import VolcEngineCodingPlan from './models/volcengine-coding-plan'

// Coding Plan serves its models on the dedicated /api/coding/v3 base path.
// The pay-as-you-go /api/v3 endpoint rejects Coding Plan API keys with
// "The API key format is incorrect" and does not consume plan quota, so the
// generic VolcEngine provider cannot be reused here.
const VOLCENGINE_CODING_PLAN_API_HOST = 'https://ark.cn-beijing.volces.com/api/coding/v3'

export const volcEngineCodingPlanProvider = defineProvider({
  id: ModelProviderEnum.VolcEngineCodingPlan,
  name: 'VolcEngine Coding Plan',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://www.volcengine.com/activity/codingplan',
    docs: 'https://www.volcengine.com/docs/ark/coding-plan-personal-ai-claude-code',
  },
  defaultSettings: {
    apiHost: VOLCENGINE_CODING_PLAN_API_HOST,
    // Required: without apiPath the settings-page host preview appends /v1,
    // showing a URL the client never requests.
    apiPath: '/chat/completions',
    models: [
      {
        modelId: 'ark-code-latest',
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'doubao-seed-evolving',
        contextWindow: 1_000_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'doubao-seed-2.1-pro',
        capabilities: ['vision', 'reasoning', 'tool_use'],
      },
      {
        modelId: 'doubao-seed-2.1-lite',
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'doubao-seed-2.0-mini',
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'minimax-m3',
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'glm-5.3',
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'glm-5.3-flash',
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'deepseek-v4.1-flash',
        contextWindow: 1_000_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'deepseek-v4-flash',
        contextWindow: 1_000_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'deepseek-v4-pro',
        contextWindow: 1_000_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'kimi-k3',
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'kimi-k2.7-code',
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'kimi-k2.8-preview',
        capabilities: ['reasoning', 'tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new VolcEngineCodingPlan(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || VOLCENGINE_CODING_PLAN_API_HOST,
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
    return `VolcEngine Coding Plan (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
