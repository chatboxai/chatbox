import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import DotHoosh, { DOTHOOSH_API_HOST } from './models/dothoosh'

/**
 * Snapshot of the live https://gateway.dothoosh.com/v1/models catalog
 * (2026-11-23): bare, vendor-free ids, all text-only reasoning models. The
 * catalog is dynamic, so Fetch replaces this list with the live one.
 */
export const dotHooshProvider = defineProvider({
  id: ModelProviderEnum.DotHoosh,
  name: 'DotHoosh',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://gateway.dothoosh.com',
    apiKey: 'https://gateway.dothoosh.com/dashboard',
    docs: 'https://gateway.dothoosh.com/docs/quickstart',
  },
  defaultSettings: {
    apiHost: DOTHOOSH_API_HOST,
    models: [
      {
        modelId: 'deepseek-flash',
        nickname: 'DeepSeek V4.1 Flash',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 393_216,
      },
      {
        modelId: 'deepseek-v4-pro',
        nickname: 'DeepSeek V4 Pro',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 393_216,
      },
      {
        modelId: 'gemini-3.5-flash-lite',
        nickname: 'Gemini 3.5 Flash-Lite',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'gemini-3.8-flash',
        nickname: 'Gemini 3.8 Flash',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'gemini-4-argon',
        nickname: 'Gemini 4 Argon',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'gpt-6-astra',
        nickname: 'GPT-6 Astra',
        capabilities: ['reasoning'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-6-luna',
        nickname: 'GPT-6 Luna',
        capabilities: ['reasoning'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-6.1-sol',
        nickname: 'GPT-6.1 Sol',
        capabilities: ['reasoning'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-6.1-terra',
        nickname: 'GPT-6.1 Terra',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-6.2-astra',
        nickname: 'GPT-6.2 Astra',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'gpt-6.2-sol',
        nickname: 'GPT-6.2 Sol',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'kimi-k2.6',
        nickname: 'Kimi K2.6',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 262_144,
      },
      {
        modelId: 'kimi-k2.7-code',
        nickname: 'Kimi K2.7 Code',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 262_144,
      },
      {
        modelId: 'kimi-k3',
        nickname: 'Kimi K3',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_048_576,
      },
      {
        modelId: 'kimi-k3.1-pro',
        nickname: 'Kimi K3.1 Pro',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 1_048_576,
      },
    ],
  },
  createModel: (config) => {
    return new DotHoosh(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost || DOTHOOSH_API_HOST,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
        useProxy: config.providerSetting.useProxy || false,
        listModelsFallback: config.providerSetting.models || dotHooshProvider.defaultSettings?.models,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `DotHoosh (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
