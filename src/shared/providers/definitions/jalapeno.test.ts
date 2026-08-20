import { describe, expect, it, vi } from 'vitest'
import type { Config, Settings } from '../../types'
import { ModelProviderEnum, ModelProviderType } from '../../types'
import type { ModelDependencies } from '../../types/adapters'
import { JALAPENO_API_HOST, jalapenoProvider } from './jalapeno'
import Jalapeno from './models/jalapeno'

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

describe('jalapenoProvider', () => {
  it('registers Jalapeno Cloud 50% Off as an OpenAI-compatible provider', () => {
    expect(jalapenoProvider.id).toBe(ModelProviderEnum.Jalapeno)
    expect(jalapenoProvider.name).toBe('Jalapeno Cloud 50% Off')
    expect(jalapenoProvider.type).toBe(ModelProviderType.OpenAI)
    expect(JALAPENO_API_HOST).toBe('https://api.jalapeno-cloud.ai/v1')
    expect(jalapenoProvider.defaultSettings?.apiHost).toBe(JALAPENO_API_HOST)
    expect(jalapenoProvider.urls).toEqual({
      website: 'https://www.jalapeno-cloud.ai',
      docs: 'https://www.jalapeno-cloud.ai/docs',
      models: 'https://www.jalapeno-cloud.ai/models',
    })
  })

  it('uses DeepSeek V4 models as curated defaults', () => {
    expect(jalapenoProvider.curatedModelIds).toEqual(['DeepSeek-V4-Pro', 'DeepSeek-V4-Flash'])
    expect(jalapenoProvider.defaultSettings?.models).toEqual([
      {
        modelId: 'DeepSeek-V4-Pro',
        nickname: 'DeepSeek V4 Pro',
        contextWindow: 1_000_000,
        capabilities: ['reasoning', 'tool_use'],
      },
      {
        modelId: 'DeepSeek-V4-Flash',
        nickname: 'DeepSeek V4 Flash',
        contextWindow: 1_000_000,
        capabilities: ['reasoning', 'tool_use'],
      },
    ])
  })

  it('formats the message header with the model nickname', () => {
    expect(jalapenoProvider.getDisplayName?.('DeepSeek-V4-Pro', jalapenoProvider.defaultSettings)).toBe(
      'Jalapeno Cloud 50% Off (DeepSeek V4 Pro)'
    )
    expect(jalapenoProvider.getDisplayName?.('unknown-model', jalapenoProvider.defaultSettings)).toBe(
      'Jalapeno Cloud 50% Off (unknown-model)'
    )
  })

  it('creates a model pointed at the Jalapeno API host', () => {
    const model = jalapenoProvider.createModel({
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

    expect(model).toBeInstanceOf(Jalapeno)
    expect(model.name).toBe('Jalapeno Cloud 50% Off')
    expect((model as Jalapeno).options.apiHost).toBe(JALAPENO_API_HOST)
    expect((model as Jalapeno).options.apiKey).toBe('sk-test')
  })

  it('prefers a custom formatted API host when provided', () => {
    const model = jalapenoProvider.createModel({
      settings: { temperature: 0.7, topP: 1 },
      globalSettings: {} as Settings,
      config: { uuid: 'test' } as Config,
      dependencies: createDependencies(),
      providerSetting: {},
      formattedApiHost: 'https://proxy.example.com/v1',
      formattedApiPath: '',
      model: { modelId: 'DeepSeek-V4-Pro' },
      effectiveApiKey: 'sk-test',
    }) as Jalapeno

    expect(model.options.apiHost).toBe('https://proxy.example.com/v1')
  })
})
