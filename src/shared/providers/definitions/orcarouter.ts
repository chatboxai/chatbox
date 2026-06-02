import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import OrcaRouter from './models/orcarouter'

export const orcaRouterProvider = defineProvider({
  id: ModelProviderEnum.OrcaRouter,
  name: 'OrcaRouter',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'orcarouter',
  curatedModelIds: [
    'orcarouter/auto',
    'openai/gpt-5.5',
    'google/gemini-3.5-flash',
    'anthropic/claude-opus-4.7',
    'grok/grok-4.3',
    'deepseek/deepseek-v4-pro',
    'minimax/minimax-m2.7',
    'qwen/qwen3.7-max',
  ],
  urls: {
    website: 'https://www.orcarouter.ai/',
    apiKey: 'https://www.orcarouter.ai/console',
    docs: 'https://docs.orcarouter.ai',
    models: 'https://www.orcarouter.ai/models',
  },
  defaultSettings: {
    apiHost: 'https://api.orcarouter.ai/v1',
    models: [
      {
        modelId: 'orcarouter/auto',
        nickname: 'OrcaRouter Auto',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 128_000,
        maxOutput: 16_384,
      },
      {
        modelId: 'openai/gpt-5.5',
        nickname: 'GPT-5.5',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'google/gemini-3.5-flash',
        nickname: 'Gemini 3.5 Flash',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'anthropic/claude-opus-4.7',
        nickname: 'Claude Opus 4.7',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'grok/grok-4.3',
        nickname: 'Grok 4.3',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 256_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'deepseek/deepseek-v4-pro',
        nickname: 'DeepSeek V4 Pro',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 163_840,
        maxOutput: 163_840,
      },
      {
        modelId: 'minimax/minimax-m2.7',
        nickname: 'MiniMax M2.7',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 204_800,
        maxOutput: 131_072,
      },
      {
        modelId: 'qwen/qwen3.7-max',
        nickname: 'Qwen 3.7 Max',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
    ],
  },
  createModel: (config) => {
    return new OrcaRouter(
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
    const nickname = providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname
    return `OrcaRouter (${nickname || modelId})`
  },
})
