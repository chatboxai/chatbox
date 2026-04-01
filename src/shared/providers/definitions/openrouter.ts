import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import OpenRouter from './models/openrouter'

export const openRouterProvider = defineProvider({
  id: ModelProviderEnum.OpenRouter,
  name: 'OpenRouter',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'openrouter',
  curatedModelIds: [
    // Top-tier flagship models
    'anthropic/claude-sonnet-4.6',
    'anthropic/claude-opus-4.6',
    'google/gemini-3-pro-preview',
    'google/gemini-3-flash-preview',
    'google/gemini-2.5-pro',
    'openai/gpt-5.1',
    'openai/gpt-5-chat',
    'openai/o4-mini',
    'x-ai/grok-4',
    'x-ai/grok-4-fast',
    // Value & reasoning models
    'deepseek/deepseek-chat-v3.1',
    'deepseek/deepseek-r1-0528:free',
    'deepseek/deepseek-r1:free',
    'moonshotai/kimi-k2',
    // Free models
    'meta-llama/llama-4-scout:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'moonshotai/kimi-k2:free',
  ],
  urls: {
    website: 'https://openrouter.ai/',
  },
  defaultSettings: {
    apiHost: 'https://openrouter.ai/api/v1',
    models: [
      // --- Anthropic ---
      {
        modelId: 'anthropic/claude-sonnet-4.6',
        nickname: 'Claude Sonnet 4.6',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'anthropic/claude-opus-4.6',
        nickname: 'Claude Opus 4.6',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      // --- Google ---
      {
        modelId: 'google/gemini-3-pro-preview',
        nickname: 'Gemini 3 Pro',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_050_000,
        maxOutput: 66_000,
      },
      {
        modelId: 'google/gemini-3-flash-preview',
        nickname: 'Gemini 3 Flash',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'google/gemini-2.5-pro',
        nickname: 'Gemini 2.5 Pro',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      // --- OpenAI ---
      {
        modelId: 'openai/gpt-5.1',
        nickname: 'GPT-5.1',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'openai/gpt-5-chat',
        nickname: 'GPT-5 Chat',
        capabilities: ['reasoning', 'vision'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'openai/o4-mini',
        nickname: 'o4 Mini',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 200_000,
        maxOutput: 100_000,
      },
      // --- xAI ---
      {
        modelId: 'x-ai/grok-4',
        nickname: 'Grok 4',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 256_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'x-ai/grok-4-fast',
        nickname: 'Grok 4 Fast',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 2_000_000,
        maxOutput: 30_000,
      },
      // --- DeepSeek ---
      {
        modelId: 'deepseek/deepseek-chat-v3.1',
        nickname: 'DeepSeek V3.1',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 163_840,
        maxOutput: 163_840,
      },
      {
        modelId: 'deepseek/deepseek-r1-0528:free',
        nickname: 'DeepSeek R1 0528 (free)',
        capabilities: ['reasoning'],
        contextWindow: 163_840,
        maxOutput: 163_840,
      },
      {
        modelId: 'deepseek/deepseek-r1:free',
        nickname: 'DeepSeek R1 (free)',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 163_840,
        maxOutput: 163_840,
      },
      // --- Moonshot ---
      {
        modelId: 'moonshotai/kimi-k2',
        nickname: 'Kimi K2',
        capabilities: ['tool_use'],
        contextWindow: 131_072,
        maxOutput: 32_768,
      },
      // --- Free models ---
      {
        modelId: 'meta-llama/llama-4-scout:free',
        nickname: 'Llama 4 Scout (free)',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 64_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'meta-llama/llama-3.3-70b-instruct:free',
        nickname: 'Llama 3.3 70B (free)',
        capabilities: ['tool_use'],
        contextWindow: 131_072,
        maxOutput: 32_768,
      },
      {
        modelId: 'moonshotai/kimi-k2:free',
        nickname: 'Kimi K2 (free)',
        capabilities: ['tool_use'],
        contextWindow: 32_800,
        maxOutput: 32_800,
      },
    ],
  },
  createModel: (config) => {
    return new OpenRouter(
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
    return `OpenRouter API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
