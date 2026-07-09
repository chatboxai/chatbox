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
    'anthropic/claude-opus-4.8',
    'anthropic/claude-sonnet-4.6',
    'google/gemini-3.5-flash',
    'google/gemini-3.1-pro-preview',
    'openai/gpt-5.4',
    'openai/gpt-5.4-mini',
    'x-ai/grok-4.3',
    'x-ai/grok-4-1-fast',
    // Value & reasoning models
    'deepseek/deepseek-v4-pro',
    'deepseek/deepseek-v4-flash',
    'deepseek/deepseek-r1-0528:free',
    'moonshotai/kimi-k2.6',
    'minimax/minimax-m3',
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
        modelId: 'anthropic/claude-opus-4.8',
        nickname: 'Claude Opus 4.8',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_000_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'anthropic/claude-sonnet-4.6',
        nickname: 'Claude Sonnet 4.6',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 200_000,
        maxOutput: 64_000,
      },
      // --- Google ---
      {
        modelId: 'google/gemini-3.5-flash',
        nickname: 'Gemini 3.5 Flash',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'google/gemini-3.1-pro-preview',
        nickname: 'Gemini 3.1 Pro',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'google/gemini-2.5-flash-lite',
        nickname: 'Gemini 2.5 Flash Lite',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      // --- OpenAI ---
      {
        modelId: 'openai/gpt-5.4',
        nickname: 'GPT-5.4',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_050_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'openai/gpt-5.4-mini',
        nickname: 'GPT-5.4 Mini',
        capabilities: ['tool_use', 'reasoning', 'vision'],
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
        modelId: 'x-ai/grok-4.3',
        nickname: 'Grok 4.3',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 256_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'x-ai/grok-4-1-fast',
        nickname: 'Grok 4.1 Fast',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 2_000_000,
        maxOutput: 30_000,
      },
      // --- DeepSeek ---
      {
        modelId: 'deepseek/deepseek-v4-pro',
        nickname: 'DeepSeek V4 Pro',
        capabilities: ['tool_use', 'reasoning'],
        contextWindow: 163_840,
        maxOutput: 163_840,
      },
      {
        modelId: 'deepseek/deepseek-v4-flash',
        nickname: 'DeepSeek V4 Flash',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
        maxOutput: 32_768,
      },
      {
        modelId: 'deepseek/deepseek-r1-0528:free',
        nickname: 'DeepSeek R1 0528 (free)',
        capabilities: ['reasoning'],
        contextWindow: 163_840,
        maxOutput: 163_840,
      },
      // --- Moonshot ---
      {
        modelId: 'moonshotai/kimi-k2.6',
        nickname: 'Kimi K2.6',
        capabilities: ['tool_use'],
        contextWindow: 131_072,
        maxOutput: 32_768,
      },
      // --- MiniMax ---
      {
        modelId: 'minimax/minimax-m3',
        nickname: 'MiniMax M3',
        capabilities: ['tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
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
      // --- Image generation models ---
      {
        modelId: 'google/gemini-3.1-flash-image',
        nickname: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
        type: 'image',
      },
      {
        modelId: 'google/gemini-3-pro-image',
        nickname: 'Nano Banana Pro (Gemini 3 Pro Image)',
        type: 'image',
      },
      {
        modelId: 'openai/gpt-5.4-image-2',
        nickname: 'GPT-5.4 Image 2',
        type: 'image',
      },
      {
        modelId: 'openai/gpt-image-1',
        nickname: 'GPT Image 1',
        type: 'image',
      },
      {
        modelId: 'bytedance-seed/seedream-4.5',
        nickname: 'Seedream 4.5',
        type: 'image',
      },
      {
        modelId: 'black-forest-labs/flux.2-pro',
        nickname: 'FLUX.2 Pro',
        type: 'image',
      },
      {
        modelId: 'sourceful/riverflow-v2.5-pro',
        nickname: 'Riverflow V2.5 Pro',
        type: 'image',
      },
      {
        modelId: 'recraft/recraft-v4',
        nickname: 'Recraft V4',
        type: 'image',
      },
    ],
  },
  createModel: (config) => {
    return new OpenRouter(
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
    return `OpenRouter API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
