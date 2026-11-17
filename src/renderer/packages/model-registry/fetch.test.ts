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

function cachedModel(modelId: string, contextWindow: number) {
  return {
    modelId,
    type: 'chat' as const,
    capabilities: ['tool_use'],
    contextWindow,
    maxOutput: 8_192,
  }
}

function blobCache(data: unknown, ageMs: number) {
  return JSON.stringify({
    data,
    timestamp: Date.now() - ageMs,
  })
}

describe('model-registry fetch', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('falls back to stale blob cache instead of the build snapshot when refresh fails', async () => {
    const staleCache = {
      openai: {
        'cached-model': cachedModel('cached-model', 222_000),
      },
    }

    mockGetStoreBlob.mockResolvedValue(blobCache(staleCache, 8 * 24 * 60 * 60 * 1000))
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))

    const { getRegistry, getRegistrySync } = await import('./fetch')

    await expect(getRegistry()).resolves.toMatchObject(staleCache)
    expect(getRegistrySync()).toMatchObject(staleCache)
    expect(getRegistrySync().deepseek['deepseek-v4-flash-vision-exp']?.capabilities).toContain('vision')
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

    await expect(getRegistry()).resolves.toMatchObject(freshRegistry)
    await expect(forceRefreshRegistry()).resolves.toMatchObject(freshRegistry)
    expect(getRegistrySync()).toMatchObject(freshRegistry)
    expect(mockSetStoreBlob).toHaveBeenCalledTimes(1)
  })

  it('does not fetch models.dev on prefetch when the 7-day blob cache is still valid', async () => {
    const validCache = {
      openai: {
        'cached-model': cachedModel('cached-model', 222_000),
      },
    }
    mockGetStoreBlob.mockResolvedValue(blobCache(validCache, 24 * 60 * 60 * 1000))

    const { prefetchModelRegistry } = await import('./fetch')
    await prefetchModelRegistry()

    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches models.dev for an unknown model even when the 7-day blob cache is still valid', async () => {
    const validCache = {
      openai: {
        'cached-model': cachedModel('cached-model', 222_000),
      },
    }
    const liveRegistry = {
      openai: {
        'cached-model': cachedModel('cached-model', 222_000),
        'new-model': cachedModel('new-model', 1_000_000),
      },
    }
    mockGetStoreBlob.mockResolvedValue(blobCache(validCache, 24 * 60 * 60 * 1000))
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(liveRegistry), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const { prefetchModelRegistry, requestUnknownModelRegistryRefresh, getRegistrySync } = await import('./fetch')
    await prefetchModelRegistry()
    expect(fetch).not.toHaveBeenCalled()

    await requestUnknownModelRegistryRefresh()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('https://models.dev/api.json')
    expect(getRegistrySync()).toMatchObject(liveRegistry)
  })

  it('does not refetch unknown models during the short cooldown after a recent attempt', async () => {
    mockGetStoreBlob.mockResolvedValue(null)
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ openai: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const { requestUnknownModelRegistryRefresh, UNKNOWN_MODEL_REFRESH_COOLDOWN_MS } = await import('./fetch')
    await requestUnknownModelRegistryRefresh()
    expect(fetch).toHaveBeenCalledTimes(1)

    await requestUnknownModelRegistryRefresh()
    expect(fetch).toHaveBeenCalledTimes(1)

    const now = Date.now()
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now + UNKNOWN_MODEL_REFRESH_COOLDOWN_MS + 1)
    try {
      await requestUnknownModelRegistryRefresh()
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      dateNow.mockRestore()
    }
  })
})
