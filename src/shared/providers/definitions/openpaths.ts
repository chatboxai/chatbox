import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import OpenPaths from './models/openpaths'

export const openPathsProvider = defineProvider({
  id: ModelProviderEnum.OpenPaths,
  name: 'OpenPaths',
  type: ModelProviderType.OpenAI,
  curatedModelIds: [
    'openpaths/auto',
    'openpaths/auto-code',
    'openpaths/auto-fast',
    'openpaths/auto-cheap',
    'openpaths/auto-reasoning',
    'openpaths/auto-vision',
    'openpaths/auto-image',
  ],
  urls: {
    website: 'https://openpaths.io',
    apiKey: 'https://openpaths.io/account',
    models: 'https://openpaths.io/v1/models',
  },
  defaultSettings: {
    apiHost: 'https://openpaths.io/v1',
    models: [
      {
        modelId: 'openpaths/auto',
        nickname: 'Auto',
        capabilities: ['tool_use', 'reasoning', 'vision'],
      },
      {
        modelId: 'openpaths/auto-code',
        nickname: 'Auto Code',
        capabilities: ['tool_use', 'reasoning'],
      },
      {
        modelId: 'openpaths/auto-fast',
        nickname: 'Auto Fast',
        capabilities: ['tool_use'],
      },
      {
        modelId: 'openpaths/auto-cheap',
        nickname: 'Auto Cheap',
        capabilities: ['tool_use'],
      },
      {
        modelId: 'openpaths/auto-reasoning',
        nickname: 'Auto Reasoning',
        capabilities: ['tool_use', 'reasoning'],
      },
      {
        modelId: 'openpaths/auto-vision',
        nickname: 'Auto Vision',
        capabilities: ['tool_use', 'vision'],
      },
      {
        modelId: 'openpaths/auto-image',
        nickname: 'Auto Image',
        capabilities: ['vision'],
      },
    ],
  },
  createModel: (config) => {
    return new OpenPaths(
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
    return `OpenPaths API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
