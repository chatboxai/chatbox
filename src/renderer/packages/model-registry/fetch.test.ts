import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetStoreBlob = vi.fn()
const mockSetStoreBlob = vi.fn()
const mockTransformFullResponse = vi.fn((raw: unknown) => raw)

vi.mock('@/platform', () => ({
  default: {
    getStoreBlob: mockGetStoreBlob,
    setStoreBlob: mockSetStoreBlob,
  },
}))

vi.mock('@shared/model-registry/enrich', () => ({
  setRuntimeRegistry: vi.fn(),
}))

vi.mock('@shared/model-registry/transform', () => ({
  transformFullResponse: mockTransformFullResponse,
}))

vi.mock('@shared/model-registry/snapshot.generated', () => ({
  MODELS_DEV_SNAPSHOT: {
    openai: {
      'snapshot-model': {
        modelId: 'snapshot-model',
        type: 'chat',
        capabilities: [],
        contextWindow: 111_000,
        maxOutput: 4_096,
      },
    },
  },
}))

describe('model-registry fetch', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('falls back to stale blob cache instead of the build snapshot when refresh fails', async () => {
    const staleCache = {
      openai: {
        'cached-model': {
          modelId: 'cached-model',
          type: 'chat',
          capabilities: ['tool_use'],
          contextWindow: 222_000,
          maxOutput: 8_192,
        },
      },
    }

    mockGetStoreBlob.mockResolvedValue(
      JSON.stringify({
        data: staleCache,
        timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000,
      })
    )
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))

    const { getRegistry, getRegistrySync } = await import('./fetch')

    await expect(getRegistry()).resolves.toEqual(staleCache)
    expect(getRegistrySync()).toEqual(staleCache)
  })

  it('keeps the current memory cache when force refresh fails', async () => {
    const freshRegistry = {
      openai: {
        'fresh-model': {
          modelId: 'fresh-model',
          type: 'chat',
          capabilities: ['vision'],
          contextWindow: 333_000,
          maxOutput: 16_384,
        },
      },
    }

    mockGetStoreBlob.mockResolvedValue(null)
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(freshRegistry), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockRejectedValueOnce(new Error('offline'))

    const { forceRefreshRegistry, getRegistry, getRegistrySync } = await import('./fetch')

    await expect(getRegistry()).resolves.toEqual(freshRegistry)
    await expect(forceRefreshRegistry()).resolves.toEqual(freshRegistry)
    expect(getRegistrySync()).toEqual(freshRegistry)
    expect(mockSetStoreBlob).toHaveBeenCalledTimes(1)
  })
})
