import type { ProviderModelInfo } from '../../types'
import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import {
  createOpenCodeModel,
  defineOpenCodeModelClasses,
  type OpenCodeApiStyle,
  type OpenCodeRoutingRules,
  resolveOpenCodeApiStyle,
} from './opencode-shared'

// OpenCode Go is the $10/month subscription tier of the Zen console, limited to open
// coding models. API-key auth only (https://opencode.ai/auth); there is no official OAuth.
// Requests go to /zen/go/v1 and are routed by model id: Responses (Grok / GPT / Muse Spark),
// Anthropic Messages (MiniMax / Qwen), otherwise Chat Completions. Note this differs from
// Zen, where MiniMax is served over Chat Completions instead.

export const OPENCODE_GO_API_HOST = 'https://opencode.ai/zen/go/v1'
export const OPENCODE_GO_AUTH_URL = 'https://opencode.ai/auth'
export const OPENCODE_GO_DOCS_URL = 'https://opencode.ai/docs/go/'
export const OPENCODE_GO_MODELS_URL = 'https://opencode.ai/zen/go/v1/models'

const ROUTING_RULES: OpenCodeRoutingRules = {
  anthropic: ['minimax-', 'qwen3.'],
  responses: ['grok-', 'gpt-', 'muse-spark'],
}

export function getOpenCodeGoApiStyle(modelId: string): OpenCodeApiStyle {
  return resolveOpenCodeApiStyle(modelId, ROUTING_RULES)
}

export function applyOpenCodeGoModelMetadata(model: ProviderModelInfo): ProviderModelInfo {
  return {
    ...model,
    // Always overwrite: getModel() may stamp the provider type (`openai`) before
    // createModel runs, which would otherwise pin MiniMax/Qwen onto the wrong surface.
    apiStyle: getOpenCodeGoApiStyle(model.modelId),
  }
}

const MODEL_CLASSES = defineOpenCodeModelClasses('OpenCode Go', (models) => models.map(applyOpenCodeGoModelMetadata))

const DEFAULT_MODELS: ProviderModelInfo[] = [
  {
    modelId: 'grok-4.5',
    nickname: 'Grok 4.5',
    apiStyle: 'openai-responses',
    capabilities: ['vision', 'tool_use', 'reasoning'],
    contextWindow: 500_000,
    maxOutput: 500_000,
  },
  {
    modelId: 'gpt-5.6-luna',
    nickname: 'GPT 5.6 Luna',
    apiStyle: 'openai-responses',
    capabilities: ['vision', 'tool_use', 'reasoning'],
    contextWindow: 1_050_000,
    maxOutput: 128_000,
  },
  {
    modelId: 'muse-spark-1.2-contributor',
    nickname: 'Muse Spark 1.2 Contributor',
    apiStyle: 'openai-responses',
    capabilities: ['vision', 'tool_use', 'reasoning'],
    contextWindow: 1_048_576,
    maxOutput: 131_072,
  },
  {
    modelId: 'glm-5.3',
    nickname: 'GLM-5.3',
    apiStyle: 'openai',
    capabilities: ['tool_use', 'reasoning'],
    contextWindow: 1_000_000,
    maxOutput: 131_072,
  },
  {
    modelId: 'glm-5.2',
    nickname: 'GLM-5.2',
    apiStyle: 'openai',
    capabilities: ['tool_use', 'reasoning'],
    contextWindow: 1_000_000,
    maxOutput: 131_072,
  },
  {
    modelId: 'glm-5.1',
    nickname: 'GLM-5.1',
    apiStyle: 'openai',
    capabilities: ['tool_use', 'reasoning'],
    contextWindow: 202_752,
    maxOutput: 32_768,
  },
  {
    modelId: 'kimi-k3',
    nickname: 'Kimi K3',
    apiStyle: 'openai',
    capabilities: ['vision', 'tool_use', 'reasoning'],
    contextWindow: 1_048_576,
    maxOutput: 131_072,
  },
  {
    modelId: 'kimi-k2.7-code',
    nickname: 'Kimi K2.7 Code',
    apiStyle: 'openai',
    capabilities: ['vision', 'tool_use', 'reasoning'],
    contextWindow: 262_144,
    maxOutput: 262_144,
  },
  {
    modelId: 'kimi-k2.6',
    nickname: 'Kimi K2.6',
    apiStyle: 'openai',
    capabilities: ['vision', 'tool_use', 'reasoning'],
    contextWindow: 262_144,
    maxOutput: 65_536,
  },
  {
    modelId: 'mimo-v2.5',
    nickname: 'MiMo-V2.5',
    apiStyle: 'openai',
    capabilities: ['vision', 'tool_use', 'reasoning'],
    contextWindow: 1_000_000,
    maxOutput: 128_000,
  },
  {
    modelId: 'mimo-v2.5-pro',
    nickname: 'MiMo-V2.5-Pro',
    apiStyle: 'openai',
    capabilities: ['tool_use', 'reasoning'],
    contextWindow: 1_048_576,
    maxOutput: 128_000,
  },
  {
    modelId: 'deepseek-v4-pro',
    nickname: 'DeepSeek V4 Pro',
    apiStyle: 'openai',
    capabilities: ['tool_use', 'reasoning'],
    contextWindow: 1_000_000,
    maxOutput: 384_000,
  },
  {
    modelId: 'deepseek-v4-flash',
    nickname: 'DeepSeek V4 Flash',
    apiStyle: 'openai',
    capabilities: ['tool_use', 'reasoning'],
    contextWindow: 1_000_000,
    maxOutput: 384_000,
  },
  {
    modelId: 'hy3',
    nickname: 'Hy3',
    apiStyle: 'openai',
    capabilities: ['tool_use', 'reasoning'],
    contextWindow: 256_000,
    maxOutput: 64_000,
  },
  {
    modelId: 'minimax-m3',
    nickname: 'MiniMax M3',
    apiStyle: 'anthropic',
    capabilities: ['vision', 'tool_use', 'reasoning'],
    contextWindow: 1_000_000,
    maxOutput: 131_072,
  },
  {
    modelId: 'minimax-m2.7',
    nickname: 'MiniMax M2.7',
    apiStyle: 'anthropic',
    capabilities: ['tool_use', 'reasoning'],
    contextWindow: 204_800,
    maxOutput: 131_072,
  },
  {
    modelId: 'minimax-m2.5',
    nickname: 'MiniMax M2.5',
    apiStyle: 'anthropic',
    capabilities: ['tool_use', 'reasoning'],
    contextWindow: 204_800,
    maxOutput: 65_536,
  },
  {
    modelId: 'qwen3.8-max',
    nickname: 'Qwen3.8 Max',
    apiStyle: 'anthropic',
    capabilities: ['vision', 'tool_use', 'reasoning'],
    contextWindow: 1_000_000,
    maxOutput: 131_072,
  },
  {
    modelId: 'qwen3.7-max',
    nickname: 'Qwen3.7 Max',
    apiStyle: 'anthropic',
    capabilities: ['tool_use', 'reasoning'],
    contextWindow: 1_000_000,
    maxOutput: 65_536,
  },
  {
    modelId: 'qwen3.7-plus',
    nickname: 'Qwen3.7 Plus',
    apiStyle: 'anthropic',
    capabilities: ['vision', 'tool_use', 'reasoning'],
    contextWindow: 1_000_000,
    maxOutput: 65_536,
  },
  {
    modelId: 'qwen3.6-plus',
    nickname: 'Qwen3.6 Plus',
    apiStyle: 'anthropic',
    capabilities: ['vision', 'tool_use', 'reasoning'],
    contextWindow: 1_000_000,
    maxOutput: 65_536,
  },
]

export const opencodeGoProvider = defineProvider({
  id: ModelProviderEnum.OpenCodeGo,
  name: 'OpenCode Go',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://opencode.ai',
    apiKey: OPENCODE_GO_AUTH_URL,
    docs: OPENCODE_GO_DOCS_URL,
    models: OPENCODE_GO_MODELS_URL,
  },
  defaultSettings: {
    apiHost: OPENCODE_GO_API_HOST,
    models: DEFAULT_MODELS,
  },
  createModel: (config) =>
    createOpenCodeModel(config, {
      classes: MODEL_CLASSES,
      defaultApiHost: OPENCODE_GO_API_HOST,
      defaultModels: DEFAULT_MODELS,
      getApiStyle: getOpenCodeGoApiStyle,
    }),
  getDisplayName: (modelId, providerSettings) => {
    return `OpenCode Go (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
