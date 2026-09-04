import { settings as defaultSettings } from '@shared/defaults'
import { ModelProviderEnum, ModelProviderType, type Settings } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getModelManifestMock } = vi.hoisted(() => ({
  getModelManifestMock: vi.fn(),
}))

vi.mock('@/packages/remote', () => ({ getModelManifest: getModelManifestMock }))
vi.mock('@/platform', () => ({ default: { type: 'desktop' } }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { getState: vi.fn() } }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ error: vi.fn() }) }))

import { getAvailableImageModels } from './image-model-catalog'

function manifest(imageModels: Array<{ modelId: string; modelName: string }>) {
  return { groupName: 'Images', models: [], imageModels }
}

function createSettings(): Settings {
  return defaultSettings()
}

describe('image model catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the Chatbox manifest, applies exclusions, and preserves server order', async () => {
    const settings = createSettings()
    settings.licenseKey = 'license'
    settings.providers = {
      [ModelProviderEnum.ChatboxAI]: { excludedModels: ['disabled-image'] },
    }
    getModelManifestMock.mockResolvedValue(
      manifest([
        { modelId: 'other-image', modelName: 'Other Image' },
        { modelId: 'gpt-image-1.5', modelName: 'GPT Image 1.5' },
        { modelId: 'disabled-image', modelName: 'Disabled Image' },
      ])
    )

    await expect(getAvailableImageModels(settings)).resolves.toEqual([
      { provider: ModelProviderEnum.ChatboxAI, modelId: 'other-image', nickname: 'Other Image' },
      { provider: ModelProviderEnum.ChatboxAI, modelId: 'gpt-image-1.5', nickname: 'GPT Image 1.5' },
    ])
    expect(getModelManifestMock).toHaveBeenCalledWith({
      aiProvider: ModelProviderEnum.ChatboxAI,
      language: settings.language,
      licenseKey: 'license',
    })
  })

  it('merges remote and manual models for configured built-in and custom providers', async () => {
    const settings = createSettings()
    settings.providers = {
      [ModelProviderEnum.Gemini]: {
        apiKey: 'gemini-key',
        models: [{ modelId: 'gemini-remote', type: 'image', nickname: 'Manual Gemini Name' }],
      },
      [ModelProviderEnum.OpenAI]: {
        apiKey: 'openai-key',
        models: [{ modelId: 'openai-manual', type: 'image', nickname: 'Manual OpenAI' }],
      },
      'custom-provider-gemini': {
        models: [{ modelId: 'custom-image', type: 'image', nickname: 'Custom Image' }],
      },
    }
    settings.customProviders = [
      {
        id: 'custom-provider-gemini',
        name: 'Custom Gemini',
        type: ModelProviderType.Gemini,
        isCustom: true,
      },
    ]
    getModelManifestMock.mockImplementation(({ aiProvider }: { aiProvider: ModelProviderEnum }) => {
      if (aiProvider === ModelProviderEnum.Gemini) {
        return Promise.resolve(manifest([{ modelId: 'gemini-remote', modelName: 'Remote Gemini Name' }]))
      }
      return Promise.resolve(manifest([{ modelId: 'openai-remote', modelName: 'Remote OpenAI' }]))
    })

    await expect(getAvailableImageModels(settings)).resolves.toEqual([
      { provider: ModelProviderEnum.Gemini, modelId: 'gemini-remote', nickname: 'Manual Gemini Name' },
      { provider: 'custom-provider-gemini', modelId: 'gemini-remote', nickname: 'Remote Gemini Name' },
      { provider: 'custom-provider-gemini', modelId: 'custom-image', nickname: 'Custom Image' },
      { provider: ModelProviderEnum.OpenAI, modelId: 'openai-remote', nickname: 'Remote OpenAI' },
      { provider: ModelProviderEnum.OpenAI, modelId: 'openai-manual', nickname: 'Manual OpenAI' },
    ])
  })

  it('omits unconfigured providers', async () => {
    const settings = createSettings()

    await expect(getAvailableImageModels(settings)).resolves.toEqual([])
    expect(getModelManifestMock).not.toHaveBeenCalled()
  })

  it('keeps manually configured image models when a manifest request fails', async () => {
    const settings = createSettings()
    settings.providers = {
      [ModelProviderEnum.OpenAI]: {
        apiKey: 'openai-key',
        models: [{ modelId: 'manual-only', type: 'image', nickname: 'Manual Only' }],
      },
    }
    getModelManifestMock.mockRejectedValue(new Error('offline'))

    await expect(getAvailableImageModels(settings)).resolves.toEqual([
      { provider: ModelProviderEnum.OpenAI, modelId: 'manual-only', nickname: 'Manual Only' },
    ])
  })

  it('omits OpenAI image models when OAuth is active', async () => {
    const settings = createSettings()
    settings.providers = {
      [ModelProviderEnum.OpenAI]: {
        apiKey: 'openai-key',
        activeAuthMode: 'oauth',
        oauth: { accessToken: 'oauth-token' },
        models: [{ modelId: 'gpt-image-2', type: 'image', nickname: 'GPT Image 2' }],
      },
    }

    await expect(getAvailableImageModels(settings)).resolves.toEqual([])
    expect(getModelManifestMock).not.toHaveBeenCalled()
  })

  it('includes OpenRouter remote and manual image models when the provider is configured', async () => {
    const settings = createSettings()
    settings.providers = {
      [ModelProviderEnum.OpenRouter]: {
        apiKey: 'openrouter-key',
        models: [{ modelId: 'google/gemini-3-pro-image', type: 'image', nickname: 'Gemini Image' }],
      },
    }
    getModelManifestMock.mockResolvedValue(manifest([{ modelId: 'openai/gpt-image-1', modelName: 'GPT Image 1' }]))

    await expect(getAvailableImageModels(settings)).resolves.toEqual([
      { provider: ModelProviderEnum.OpenRouter, modelId: 'openai/gpt-image-1', nickname: 'GPT Image 1' },
      { provider: ModelProviderEnum.OpenRouter, modelId: 'google/gemini-3-pro-image', nickname: 'Gemini Image' },
    ])
  })

  it('includes manually marked image models from custom OpenAI-compatible providers', async () => {
    const settings = createSettings()
    settings.providers = {
      'custom-openai': {
        apiKey: 'custom-key',
        models: [
          { modelId: 'local-chat', type: 'chat' },
          { modelId: 'flux-local', type: 'image', nickname: 'Flux Local' },
        ],
      },
      'custom-responses': {
        models: [{ modelId: 'gpt-image-1', type: 'image', nickname: 'Responses Image' }],
      },
    }
    settings.customProviders = [
      {
        id: 'custom-openai',
        name: 'Local OpenAI',
        type: ModelProviderType.OpenAI,
        isCustom: true,
      },
      {
        id: 'custom-responses',
        name: 'Custom Responses',
        type: ModelProviderType.OpenAIResponses,
        isCustom: true,
      },
    ]

    await expect(getAvailableImageModels(settings)).resolves.toEqual([
      { provider: 'custom-openai', modelId: 'flux-local', nickname: 'Flux Local' },
      { provider: 'custom-responses', modelId: 'gpt-image-1', nickname: 'Responses Image' },
    ])
    expect(getModelManifestMock).not.toHaveBeenCalled()
  })

  it('keeps OpenAI image models when OAuth credentials are stored but API key mode is active', async () => {
    const settings = createSettings()
    settings.providers = {
      [ModelProviderEnum.OpenAI]: {
        apiKey: 'openai-key',
        activeAuthMode: 'apikey',
        oauth: { accessToken: 'oauth-token' },
      },
    }
    getModelManifestMock.mockResolvedValue(manifest([{ modelId: 'gpt-image-2', modelName: 'GPT Image 2' }]))

    await expect(getAvailableImageModels(settings)).resolves.toEqual([
      { provider: ModelProviderEnum.OpenAI, modelId: 'gpt-image-2', nickname: 'GPT Image 2' },
    ])
  })
})
