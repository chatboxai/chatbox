import { ModelProviderEnum, ModelProviderType, type ProviderSettings } from '@shared/types'
import type { ApiRequestOptions, ModelDependencies } from '@shared/types/adapters'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createModelDependencies } from '@/adapters'
import CustomProviderSettingUtil from './custom-provider-setting-util'

vi.mock('@/adapters', () => ({
  createModelDependencies: vi.fn(),
}))

const mockScope: SentryScope = {
  setTag: vi.fn(),
  setExtra: vi.fn(),
}

class TestCustomProviderSettingUtil extends CustomProviderSettingUtil {
  public listModels(settings: ProviderSettings) {
    return this.listProviderModels(settings)
  }
}

function createDependencies(apiRequest: ModelDependencies['request']['apiRequest']): ModelDependencies {
  return {
    request: {
      apiRequest,
      fetchWithOptions: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn((callback: (scope: SentryScope) => void) => callback(mockScope)),
    },
    getRemoteConfig: vi.fn(),
    platformType: 'mobile',
  }
}

describe('CustomProviderSettingUtil network compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    {
      type: ModelProviderType.Claude,
      response: { data: [{ id: 'claude-test', type: 'model' }] },
    },
    {
      type: ModelProviderType.Gemini,
      response: {
        models: [
          {
            name: 'models/gemini-test',
            version: '1',
            displayName: 'Gemini Test',
            description: '',
            inputTokenLimit: 1024,
            outputTokenLimit: 128,
            supportedGenerationMethods: ['generateContent'],
            temperature: 1,
            topP: 1,
            topK: 1,
          },
        ],
      },
    },
  ])('passes useProxy while listing $type models', async ({ type, response }) => {
    const apiRequest = vi.fn((_options: ApiRequestOptions) =>
      Promise.resolve(new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } }))
    )
    vi.mocked(createModelDependencies).mockResolvedValue(createDependencies(apiRequest))
    const util = new TestCustomProviderSettingUtil(ModelProviderEnum.Custom, type)

    await util.listModels({
      apiHost: 'http://192.168.1.10:8000',
      apiKey: 'test-key',
      useProxy: true,
    })

    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({ useProxy: true }))
  })
})
