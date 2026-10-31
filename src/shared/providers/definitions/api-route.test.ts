import { describe, expect, it, vi } from 'vitest'
import type { ModelDependencies } from '../../types/adapters'
import { apiRouteProvider } from './api-route'
import ApiRoute from './models/api-route'

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

describe('apiRouteProvider', () => {
  it('registers the API Route endpoint without hardcoded models', () => {
    expect(apiRouteProvider).toMatchObject({
      id: 'api-route',
      name: 'API Route',
      defaultSettings: {
        apiHost: 'https://global.api-route.com/v1',
        models: [],
      },
    })
  })

  it('discovers models from the OpenAI-compatible endpoint', async () => {
    const apiRequest = vi.fn().mockResolvedValue(
      Response.json({
        object: 'list',
        data: [{ id: 'available-model', object: 'model', created: 0, owned_by: 'api-route' }],
      })
    )
    const model = new ApiRoute(
      {
        apiKey: 'test-key',
        model: { modelId: '', type: 'chat' },
      },
      createDependencies(apiRequest)
    )

    await expect(model.listModels()).resolves.toEqual([{ modelId: 'available-model', type: 'chat' }])
    expect(apiRequest).toHaveBeenCalledWith({
      url: 'https://global.api-route.com/v1/models',
      method: 'GET',
      headers: { Authorization: 'Bearer test-key' },
      useProxy: undefined,
    })
  })
})
