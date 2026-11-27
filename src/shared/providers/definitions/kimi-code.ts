import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import OpenAI from './models/openai'

/**
 * Kimi Code (kimi.com/code) subscription endpoint.
 *
 * Keys issued by the Kimi Code console start with `sk-kimi-` and only work
 * against this host — the Moonshot Open Platform hosts (api.moonshot.ai /
 * api.moonshot.cn) reject them with 401. The endpoint is OpenAI compatible and
 * exposes the coding-plan models below.
 */
export const KIMI_CODE_API_HOST = 'https://api.kimi.com/coding/v1'

const provider = defineProvider({
  id: ModelProviderEnum.KimiCode,
  name: 'Kimi Code',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://www.kimi.com/code',
  },
  defaultSettings: {
    apiHost: KIMI_CODE_API_HOST,
    // The Kimi Code gateway does not send CORS headers, so the WebView cannot
    // call it directly — route requests through the native HTTP bridge.
    useProxy: true,
    models: [
      {
        modelId: 'kimi-for-coding',
        nickname: 'K2.8 Preview',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
      },
      {
        modelId: 'kimi-for-coding-highspeed',
        nickname: 'K2.7 Code Highspeed',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 262_144,
      },
      {
        modelId: 'k3.1-pro',
        nickname: 'K3.1 Pro',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
      },
      {
        modelId: 'k3.1-pro-highspeed',
        nickname: 'K3.1 Pro Highspeed',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
      },
      {
        modelId: 'k3',
        nickname: 'K3',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 1_048_576,
      },
      {
        modelId: 'k3-256k',
        nickname: 'K3 256K',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 262_144,
      },
    ],
  },
  createModel: (createConfig) => {
    return new OpenAI(
      {
        apiKey: createConfig.effectiveApiKey,
        apiHost: createConfig.formattedApiHost || KIMI_CODE_API_HOST,
        model: createConfig.model,
        dalleStyle: 'vivid',
        temperature: createConfig.settings.temperature,
        topP: createConfig.settings.topP,
        maxOutputTokens: createConfig.settings.maxTokens,
        injectDefaultMetadata: createConfig.globalSettings.injectDefaultMetadata,
        useProxy: createConfig.providerSetting.useProxy || false,
        stream: createConfig.settings.stream,
        listModelsFallback: createConfig.providerSetting.models || provider.defaultSettings?.models,
      },
      createConfig.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `Kimi Code (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
