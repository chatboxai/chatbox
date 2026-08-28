import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Synthorai from './models/synthorai'

export const synthoraiProvider = defineProvider({
  id: ModelProviderEnum.Synthorai,
  name: 'Synthorai',
  type: ModelProviderType.OpenAI,
  // `modelsDevProviderId` is omitted on purpose: Synthorai has no models.dev entry yet,
  // so naming one would point at nothing. Eight of the checked-in definitions omit it,
  // including `vercel-ai-gateway`.
  curatedModelIds: [
    'claude-opus-5',
    'claude-sonnet-5',
    'gpt-5.6-sol',
    'gemini-3.7-flash',
    'deepseek-v4-pro',
    'glm-5.2',
    'kimi-k3',
  ],
  urls: {
    website: 'https://synthorai.io',
    apiKey: 'https://synthorai.io/docs/quickstart/',
    docs: 'https://synthorai.io/docs/',
    models: 'https://synthorai.io/models/',
  },
  defaultSettings: {
    apiHost: 'https://synthorai.io/v1',
    // Every contextWindow, maxOutput and capability below was read from
    // https://synthorai.io/api/models rather than written from memory: `vision` from
    // `input_modalities` containing `image`, `tool_use` from `capabilities` containing
    // `tools`, `reasoning` likewise. The catalog is public and needs no key, so these
    // are reproducible.
    models: [
      // --- Anthropic ---
      {
        modelId: 'claude-opus-5',
        nickname: 'Claude Opus 5',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'claude-sonnet-5',
        nickname: 'Claude Sonnet 5',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      // --- OpenAI ---
      {
        modelId: 'gpt-5.6-sol',
        nickname: 'GPT-5.6 Sol',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      // --- Google ---
      {
        modelId: 'gemini-3.7-flash',
        nickname: 'Gemini 3.7 Flash',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      // --- DeepSeek ---
      {
        modelId: 'deepseek-v4-pro',
        nickname: 'DeepSeek V4 Pro',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_000_000,
        maxOutput: 393_216,
      },
      // --- Z.AI ---
      {
        modelId: 'glm-5.2',
        nickname: 'GLM-5.2',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_048_576,
        maxOutput: 131_072,
      },
      // --- Moonshot ---
      {
        modelId: 'kimi-k3',
        nickname: 'Kimi K3',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 1_000_000,
        maxOutput: 131_072,
      },
    ],
  },
  createModel: (config) => {
    return new Synthorai(
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
    return `Synthorai (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
