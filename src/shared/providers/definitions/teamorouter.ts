import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import TeamoRouter from './models/teamorouter'

const TEAMOROUTER_API_HOST = 'https://api.teamorouter.com/v1'

export const teamoRouterProvider = defineProvider({
  id: ModelProviderEnum.TeamoRouter,
  name: 'TeamoRouter',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://teamorouter.com',
    apiKey: 'https://teamorouter.com/dashboard',
    docs: 'https://teamorouter.com/docs',
    models: 'https://teamorouter.com/models',
  },
  defaultSettings: {
    apiHost: TEAMOROUTER_API_HOST,
    models: [
      {
        modelId: 'claude-sonnet-5-5',
        nickname: 'Claude Sonnet 5.5',
        capabilities: ['reasoning', 'tool_use', 'vision'],
      },
      {
        modelId: 'gpt-6-astra',
        nickname: 'GPT-6 Astra',
        capabilities: ['reasoning', 'tool_use', 'vision'],
      },
      {
        modelId: 'deepseek-v4-flash',
        nickname: 'DeepSeek V4 Flash',
        capabilities: ['reasoning', 'tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new TeamoRouter(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || TEAMOROUTER_API_HOST,
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
    return `TeamoRouter (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
