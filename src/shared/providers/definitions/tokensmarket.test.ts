import { describe, expect, it, vi } from 'vitest'
import type { ModelDependencies } from '../../types/adapters'
import { tokenMarketProvider } from './tokensmarket'
import TokenMarket from './models/tokensmarket'

const createDependencies = (apiRequest = vi.fn()): ModelDependencies => ({
  request: {
    fetchWithOptions: vi.fn(),
    apiRequest,
  },
  storage: {
    saveImage: vi.fn(),
    getImage: vi.fn(),
  },
  sentry: {
    captureException: vi.fn(),
    withScope: vi.fn(),
  },
  getRemoteConfig: vi.fn(),
  platformType: 'desktop',
})

describe('tokenMarketProvider', () => {
  it('registers the Token Market endpoint without hardcoded models', () => {
    expect(tokenMarketProvider).toMatchObject({
      id: 'tokensmarket',
      name: 'Token Market',
      defaultSettings: {
        apiHost: 'https://api.tokensmarket.ai/v1',
        models: [],
      },
    })
  })

  it('discovers models from the authenticated OpenAI-compatible endpoint', async () => {
    const apiRequest = vi.fn().mockResolvedValue(
      Response.json({
        object: 'list',
        data: [{ id: 'available-model', object: 'model', created: 0, owned_by: 'tokensmarket' }],
      })
    )
    const model = new TokenMarket(
      {
        apiKey: 'test-key',
        model: { modelId: '', type: 'chat' },
      },
      createDependencies(apiRequest)
    )

    await expect(model.listModels()).resolves.toEqual([{ modelId: 'available-model', type: 'chat' }])
    expect(apiRequest).toHaveBeenCalledWith({
      url: 'https://api.tokensmarket.ai/v1/models',
      method: 'GET',
      headers: { Authorization: 'Bearer test-key' },
      useProxy: undefined,
    })
  })
})
