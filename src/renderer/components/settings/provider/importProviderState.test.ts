import { ModelProviderEnum, ModelProviderType } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildImportedProviderSettingsUpdate } from './importProviderState'

describe('buildImportedProviderSettingsUpdate', () => {
  it('updates only provider settings for builtin providers', () => {
    const update = buildImportedProviderSettingsUpdate({
      importedConfig: {
        id: ModelProviderEnum.OpenAI,
        apiHost: 'https://mirror.example.com',
        apiKey: 'sk-mirror',
        models: [{ modelId: 'gpt-5' }],
      },
      existingProvider: {
        id: ModelProviderEnum.OpenAI,
        name: 'OpenAI',
        type: ModelProviderType.OpenAI,
      },
      providers: {
        [ModelProviderEnum.OpenAI]: { apiKey: 'old-key' },
      },
      customProviders: [
        {
          id: 'custom-1',
          isCustom: true,
          name: 'Custom One',
          type: ModelProviderType.OpenAI,
        },
      ],
    })

    expect(update).toEqual({
      providers: {
        [ModelProviderEnum.OpenAI]: {
          apiHost: 'https://mirror.example.com',
          apiPath: '',
          apiKey: 'sk-mirror',
          models: [{ modelId: 'gpt-5' }],
        },
      },
    })
  })

  it('adds custom provider base info and dedupes models on insert', () => {
    const update = buildImportedProviderSettingsUpdate({
      importedConfig: {
        id: 'custom-openai',
        name: 'Custom OpenAI',
        type: ModelProviderType.OpenAI,
        isCustom: true,
        apiHost: 'https://api.example.com',
        apiKey: 'sk-test',
        models: [{ modelId: 'gpt-5' }, { modelId: 'gpt-5' }],
      },
      existingProvider: null,
      providers: {},
      customProviders: [],
    })

    expect(update).toEqual({
      customProviders: [
        {
          id: 'custom-openai',
          name: 'Custom OpenAI',
          type: ModelProviderType.OpenAI,
          iconUrl: undefined,
          urls: {},
          isCustom: true,
        },
      ],
      providers: {
        'custom-openai': {
          apiHost: 'https://api.example.com',
          apiPath: '',
          apiKey: 'sk-test',
          models: [{ modelId: 'gpt-5' }],
        },
      },
    })
  })

  it('overwrites an existing custom provider without touching siblings', () => {
    const update = buildImportedProviderSettingsUpdate({
      importedConfig: {
        id: 'custom-openai',
        name: 'Custom OpenAI v2',
        type: ModelProviderType.OpenAIResponses,
        isCustom: true,
        apiHost: 'https://api-v2.example.com',
        models: [{ modelId: 'gpt-5-pro' }],
      },
      existingProvider: {
        id: 'custom-openai',
        name: 'Custom OpenAI',
        type: ModelProviderType.OpenAI,
        isCustom: true,
      },
      providers: {
        'custom-openai': { apiKey: 'sk-old' },
        sibling: { apiKey: 'sk-sibling' },
      },
      customProviders: [
        {
          id: 'custom-openai',
          name: 'Custom OpenAI',
          type: ModelProviderType.OpenAI,
          isCustom: true,
        },
        {
          id: 'sibling',
          name: 'Sibling',
          type: ModelProviderType.Claude,
          isCustom: true,
        },
      ],
    })

    expect(update).toEqual({
      customProviders: [
        {
          id: 'custom-openai',
          name: 'Custom OpenAI v2',
          type: ModelProviderType.OpenAIResponses,
          iconUrl: undefined,
          urls: {},
          isCustom: true,
        },
        {
          id: 'sibling',
          name: 'Sibling',
          type: ModelProviderType.Claude,
          isCustom: true,
        },
      ],
      providers: {
        'custom-openai': {
          apiHost: 'https://api-v2.example.com',
          apiPath: '',
          apiKey: '',
          models: [{ modelId: 'gpt-5-pro' }],
        },
        sibling: { apiKey: 'sk-sibling' },
      },
    })
  })

  it('rejects custom providers whose ids conflict with builtin providers', () => {
    expect(() =>
      buildImportedProviderSettingsUpdate({
        importedConfig: {
          id: ModelProviderEnum.OpenAI,
          name: 'OpenAI Mirror',
          type: ModelProviderType.OpenAI,
          isCustom: true,
          apiHost: 'https://mirror.example.com',
        },
        existingProvider: {
          id: ModelProviderEnum.OpenAI,
          name: 'OpenAI',
          type: ModelProviderType.OpenAI,
        },
        providers: {},
        customProviders: [],
      })
    ).toThrow('conflicts with a builtin provider ID')
  })
})
