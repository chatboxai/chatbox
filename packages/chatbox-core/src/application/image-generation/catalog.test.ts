import { settings as defaultSettings } from '@shared/defaults'
import { ModelProviderEnum, ModelProviderType } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  buildImageModelGroups,
  getConfiguredImageProviders,
  getImageModelRatioOptions,
  type ImageModelProvider,
  mergeImageModels,
  parseImageModelManifestResponse,
  resolveImageModelSelection,
  resolveImageRatioSelection,
  supportsImageReferenceInput,
} from './catalog'

const providers: ImageModelProvider[] = [
  { id: ModelProviderEnum.ChatboxAI, name: 'Chatbox AI' },
  { id: ModelProviderEnum.OpenAI, name: 'OpenAI' },
  { id: ModelProviderEnum.Gemini, name: 'Gemini' },
  { id: ModelProviderEnum.OpenRouter, name: 'OpenRouter' },
  { id: 'custom-gemini', name: 'Custom Gemini', isCustom: true, type: ModelProviderType.Gemini },
  { id: 'custom-responses', name: 'Custom Responses', isCustom: true, type: ModelProviderType.OpenAIResponses },
]
const capabilities = { aspectRatio: { values: ['16:9'] }, inputReferences: { min: 1, max: 2 } }

describe('shared image catalog', () => {
  it('validates remote manifests and preserves optional empty image catalogs', () => {
    expect(parseImageModelManifestResponse({ data: {} })).toEqual([])
    expect(parseImageModelManifestResponse({ data: { imageModels: [{ modelId: 'image' }] } })).toEqual([
      { modelId: 'image', displayName: 'image' },
    ])
    expect(
      parseImageModelManifestResponse({
        data: { imageModels: [{ modelId: 'image', modelName: 'Image', description: 'Localized description' }] },
      })
    ).toEqual([{ modelId: 'image', displayName: 'Image', description: 'Localized description' }])
    expect(() => parseImageModelManifestResponse({ data: { imageModels: [{ id: 'image' }] } })).toThrow()
  })

  it('merges manual display names while preserving remote metadata and order', () => {
    expect(
      mergeImageModels(
        [{ modelId: 'remote', displayName: 'Remote', description: 'Remote description', capabilities }],
        [
          { modelId: 'remote', displayName: 'Renamed' },
          { modelId: 'manual', displayName: 'Manual' },
        ]
      )
    ).toEqual([
      { modelId: 'remote', displayName: 'Renamed', description: 'Remote description', capabilities },
      { modelId: 'manual', displayName: 'Manual' },
    ])
  })

  it('uses authentication for builtins and image/manual configuration for supported custom providers', () => {
    const settings = defaultSettings()
    settings.providers = { openai: { models: [{ modelId: 'manual', type: 'image' }] } }
    expect(getConfiguredImageProviders(providers, settings, 'mobile')).toEqual([])
    settings.licenseKey = 'license'
    settings.providers = {
      openai: { apiKey: 'key' },
      gemini: { apiKey: 'key' },
      openrouter: { apiKey: 'key' },
      'custom-gemini': { models: [{ modelId: 'own', type: 'image' }] },
      'custom-responses': { models: [{ modelId: 'own', type: 'image' }] },
    }
    expect(getConfiguredImageProviders(providers, settings, 'mobile')).toEqual(providers)
    settings.licenseKey = undefined
    settings.providers.openai.apiKey = ''
    expect(getConfiguredImageProviders(providers, settings, 'mobile').map((provider) => provider.id)).toEqual([
      'gemini',
      'openrouter',
      'custom-gemini',
      'custom-responses',
    ])
  })

  it('preserves Web grouping, Chatbox exclusions, and custom Gemini inheritance', () => {
    const settings = defaultSettings()
    settings.providers = {
      'chatbox-ai': { excludedModels: ['hidden'] },
      gemini: { models: [{ modelId: 'gemini-image', nickname: 'Manual name', type: 'image' }] },
      'custom-gemini': { models: [{ modelId: 'own', type: 'image' }] },
      'custom-responses': { models: [{ modelId: 'responses-image', type: 'image' }, { modelId: 'chat' }] },
    }
    const groups = buildImageModelGroups({
      providers,
      settings,
      platform: 'mobile',
      remoteModels: {
        'chatbox-ai': [
          { modelId: 'hidden', displayName: 'Hidden' },
          { modelId: 'visible', displayName: 'Visible' },
        ],
        gemini: [{ modelId: 'gemini-image', displayName: 'Remote Gemini' }],
        openai: [{ modelId: 'openai-image', displayName: 'OpenAI' }],
        openrouter: [{ modelId: 'router-image', displayName: 'OpenRouter', capabilities }],
      },
    })
    expect(groups.map((group) => group.providerId)).toEqual([
      'chatbox-ai',
      'gemini',
      'custom-gemini',
      'openai',
      'openrouter',
      'custom-responses',
    ])
    expect(groups[0]?.models.map((model) => model.modelId)).toEqual(['visible'])
    expect(groups[1]?.models[0]?.displayName).toBe('Manual name')
    expect(groups[2]?.models.map((model) => model.modelId)).toEqual(['gemini-image', 'own'])
    expect(groups[5]?.models.map((model) => model.modelId)).toEqual(['responses-image'])
  })

  it('removes OpenAI image generation while desktop OAuth authentication is active', () => {
    const settings = defaultSettings()
    settings.providers = {
      openai: {
        activeAuthMode: 'oauth',
        oauth: { accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 10000 },
      },
    }
    expect(
      buildImageModelGroups({
        providers,
        settings,
        platform: 'desktop',
        remoteModels: {
          openai: [{ modelId: 'gpt-image', displayName: 'GPT Image' }],
        },
      })
    ).toEqual([])
  })

  it('selects the first remaining model and resets invalid ratios while retaining unknown-family defaults', () => {
    const groups = [
      { providerId: 'openai', label: 'OpenAI', models: [{ modelId: 'gpt-image-2', displayName: 'GPT Image' }] },
    ]
    expect(resolveImageModelSelection(groups, 'missing', 'missing')).toEqual({
      provider: 'openai',
      model: 'gpt-image-2',
    })
    expect(resolveImageModelSelection([], 'openai', 'gpt-image-2')).toBeNull()
    expect(getImageModelRatioOptions('gpt-image-2')).toEqual(['auto', '1:1', '3:2', '2:3'])
    expect(getImageModelRatioOptions('dynamic', { aspectRatio: null, inputReferences: null })).toEqual(['auto'])
    expect(resolveImageRatioSelection('3:2', getImageModelRatioOptions('dynamic', capabilities))).toBe('auto')
  })

  it('exposes reference input only for an implemented and supported provider protocol', () => {
    expect(supportsImageReferenceInput({ provider: 'chatbox-ai', modelId: 'image' })).toBe(true)
    expect(supportsImageReferenceInput({ provider: 'chatbox-ai', modelId: 'image' }, capabilities)).toBe(true)
    for (const provider of ['chatbox-ai', 'openrouter']) {
      expect(
        supportsImageReferenceInput({ provider, modelId: 'image' }, { aspectRatio: null, inputReferences: { max: 0 } })
      ).toBe(false)
      expect(
        supportsImageReferenceInput({ provider, modelId: 'image' }, { aspectRatio: null, inputReferences: null })
      ).toBe(false)
    }
    expect(supportsImageReferenceInput({ provider: 'openrouter', modelId: 'image' }, capabilities)).toBe(true)
    expect(supportsImageReferenceInput({ provider: 'openrouter', modelId: 'image' })).toBe(false)
    expect(
      supportsImageReferenceInput(
        { provider: 'openrouter', modelId: 'image' },
        { aspectRatio: null, inputReferences: null }
      )
    ).toBe(false)
    for (const provider of ['openai', 'gemini', 'custom-responses']) {
      expect(supportsImageReferenceInput({ provider, modelId: 'image' }, capabilities)).toBe(false)
    }
  })
})
