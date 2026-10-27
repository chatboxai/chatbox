import { describe, expect, it, vi } from 'vitest'
import type { Config, Settings } from '../../types'
import { ModelProviderEnum, ModelProviderType } from '../../types'
import type { ModelDependencies } from '../../types/adapters'
import { WATT_API_HOST, wattProvider } from './watt'
import Watt from './models/watt'

function createDependencies(): ModelDependencies {
  return {
    request: {
      apiRequest: vi.fn(),
      fetchWithOptions: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      withScope: vi.fn(),
      captureException: vi.fn(),
    },
    getRemoteConfig: vi.fn().mockReturnValue({}),
  }
}

describe('wattProvider', () => {
  it('registers Watt Cloud as an OpenAI-compatible provider', () => {
    expect(wattProvider.id).toBe(ModelProviderEnum.WattCloud)
    expect(wattProvider.name).toBe('Watt Cloud')
    expect(wattProvider.type).toBe(ModelProviderType.OpenAI)
    expect(WATT_API_HOST).toBe('https://api.watt-cloud.com/v1')
    expect(wattProvider.defaultSettings?.apiHost).toBe(WATT_API_HOST)
    expect(wattProvider.urls).toEqual({
      website: 'https://www.watt-cloud.com',
      docs: 'https://www.watt-cloud.com/docs/',
      apiKey: 'https://www.watt-cloud.com/workspaces/keys',
    })
  })

  it('ships the DeepSeek V4 catalog as defaults', () => {
    expect(wattProvider.defaultSettings?.models).toEqual([
      {
        modelId: 'DeepSeek-V4-Pro',
        nickname: 'DeepSeek V4 Pro',
        contextWindow: 1_048_576,
        maxOutput: 384_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'DeepSeek-V4-Flash',
        nickname: 'DeepSeek V4 Flash',
        contextWindow: 1_048_576,
        maxOutput: 384_000,
        capabilities: ['reasoning', 'tool_use'],
      },
    ])
  })

  it('formats the message header with the model nickname', () => {
    expect(wattProvider.getDisplayName?.('DeepSeek-V4-Pro', wattProvider.defaultSettings)).toBe(
      'Watt Cloud (DeepSeek V4 Pro)'
    )
    expect(wattProvider.getDisplayName?.('unknown-model', wattProvider.defaultSettings)).toBe(
      'Watt Cloud (unknown-model)'
    )
  })

  it('creates a model pointed at the Watt API host', () => {
    const model = wattProvider.createModel({
      settings: { temperature: 0.7, topP: 1 },
      globalSettings: {} as Settings,
      config: { uuid: 'test' } as Config,
      dependencies: createDependencies(),
      providerSetting: {},
      formattedApiHost: '',
      formattedApiPath: '',
      model: { modelId: 'DeepSeek-V4-Pro' },
      effectiveApiKey: 'sk-test',
    })

    expect(model).toBeInstanceOf(Watt)
    expect(model.name).toBe('Watt Cloud')
    expect((model as Watt).options.apiHost).toBe(WATT_API_HOST)
    expect((model as Watt).options.apiKey).toBe('sk-test')
  })

  it('prefers a custom formatted API host when provided', () => {
    const model = wattProvider.createModel({
      settings: { temperature: 0.7, topP: 1 },
      globalSettings: {} as Settings,
      config: { uuid: 'test' } as Config,
      dependencies: createDependencies(),
      providerSetting: {},
      formattedApiHost: 'https://proxy.example.com/v1',
      formattedApiPath: '',
      model: { modelId: 'DeepSeek-V4-Pro' },
      effectiveApiKey: 'sk-test',
    }) as Watt

    expect(model.options.apiHost).toBe('https://proxy.example.com/v1')
  })
})
