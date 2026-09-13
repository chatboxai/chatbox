import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Hubris from './models/hubris'

export const hubrisProvider = defineProvider({
  id: ModelProviderEnum.Hubris,
  name: 'Hubris',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://hubris.pw/',
    apiKey: 'https://hubris.pw/keys',
    docs: 'https://hubris.pw/docs',
    models: 'https://hubris.pw/models',
  },
  defaultSettings: {
    apiHost: 'https://api.hubris.pw/v1',
    models: [
      {
        modelId: 'anthropic/claude-sonnet-5',
        nickname: 'Claude Sonnet 5',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
      },
      {
        modelId: 'anthropic/claude-opus-5',
        nickname: 'Claude Opus 5',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
      },
      {
        modelId: 'anthropic/claude-fable-5.1',
        nickname: 'Claude Fable 5.1',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
      },
      {
        modelId: 'openai/gpt-6-astra',
        nickname: 'GPT-6 Astra',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_050_000,
      },
      {
        modelId: 'openai/gpt-5.6-luna',
        nickname: 'GPT-5.6 Luna',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_050_000,
      },
      {
        modelId: 'google/gemini-3.8-flash',
        nickname: 'Gemini 3.8 Flash',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
      },
      {
        modelId: 'google/gemini-3.7-flash',
        nickname: 'Gemini 3.7 Flash',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
      },
      {
        modelId: 'deepseek/deepseek-v4-pro',
        nickname: 'DeepSeek V4 Pro',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_048_576,
      },
      {
        modelId: 'moonshotai/kimi-k3',
        nickname: 'Kimi K3',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
      },
      {
        modelId: 'x-ai/grok-4.6',
        nickname: 'Grok 4.6',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 500_000,
      },
      {
        modelId: 'z-ai/glm-5.3',
        nickname: 'GLM 5.3',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_310_720,
      },
      {
        modelId: 'qwen/qwen3-max',
        nickname: 'Qwen3 Max',
        capabilities: ['tool_use'],
        contextWindow: 262_144,
      },
    ],
  },
  createModel: (config) => {
    return new Hubris(
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
    return `Hubris API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
