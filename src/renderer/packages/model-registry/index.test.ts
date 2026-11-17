import { beforeEach, describe, expect, it, vi } from 'vitest'

const registry = {
  openai: {
    'gpt-4o': {
      modelId: 'gpt-4o',
      type: 'chat' as const,
      capabilities: [],
      contextWindow: 400_000,
      maxOutput: 128_000,
    },
  },
  'github-copilot': {
    'gpt-4o': {
      modelId: 'gpt-4o',
      type: 'chat' as const,
      capabilities: [],
      contextWindow: 128_000,
      maxOutput: 4_096,
    },
  },
}

const { requestUnknownModelRegistryRefresh } = vi.hoisted(() => ({
  requestUnknownModelRegistryRefresh: vi.fn<() => Promise<typeof registry> | null>(() => null),
}))

vi.mock('./fetch', () => ({
  fetchAndUpdateRegistry: vi.fn(),
  forceRefreshRegistry: vi.fn(),
  getRegistry: vi.fn(async () => registry),
  getRegistrySync: vi.fn(() => registry),
  getRegistryVersion: vi.fn(() => 0),
  prefetchModelRegistry: vi.fn(),
  requestUnknownModelRegistryRefresh,
  subscribeRegistry: vi.fn(() => () => {}),
}))

describe('provider-aware model-registry lookups', () => {
  beforeEach(() => {
    requestUnknownModelRegistryRefresh.mockReset()
    requestUnknownModelRegistryRefresh.mockReturnValue(null)
  })

  it('prefers the selected provider registry when model ids overlap', async () => {
    const { getProviderModelContextWindow, getProviderModelContextWindowSync } = await import('./index')

    expect(getProviderModelContextWindowSync('openai', 'gpt-4o')).toBe(400_000)
    expect(getProviderModelContextWindowSync('github-copilot', 'gpt-4o')).toBe(128_000)
    await expect(getProviderModelContextWindow('github-copilot', 'gpt-4o')).resolves.toBe(128_000)
    expect(requestUnknownModelRegistryRefresh).not.toHaveBeenCalled()
  })

  it('supports provider-scoped prefix matches for fine-tuned model ids', async () => {
    const { getProviderModelContextWindowSync } = await import('./index')

    expect(getProviderModelContextWindowSync('openai', 'gpt-4o:ft-team')).toBe(400_000)
    expect(getProviderModelContextWindowSync('github-copilot', 'gpt-4o:ft-team')).toBe(128_000)
    expect(requestUnknownModelRegistryRefresh).not.toHaveBeenCalled()
  })

  it('does not refresh models.dev on a cache hit', async () => {
    const { getModelContextWindow, getModelContextWindowSync, getProviderModelContextWindowSync } = await import(
      './index'
    )

    expect(getProviderModelContextWindowSync('openai', 'gpt-4o')).toBe(400_000)
    expect(getModelContextWindowSync('gpt-4o')).not.toBeNull()
    await expect(getModelContextWindow('gpt-4o')).resolves.not.toBeNull()
    expect(requestUnknownModelRegistryRefresh).not.toHaveBeenCalled()
  })

  it('refreshes models.dev immediately when a model id is missing from cache', async () => {
    const { getModelContextWindowSync, getProviderModelContextWindowSync } = await import('./index')

    expect(getModelContextWindowSync('brand-new-model')).toBeNull()
    expect(requestUnknownModelRegistryRefresh).toHaveBeenCalledTimes(1)

    expect(getProviderModelContextWindowSync('openai', 'brand-new-model')).toBeNull()
    expect(requestUnknownModelRegistryRefresh).toHaveBeenCalledTimes(2)
  })

  it('awaits the unknown-model refresh before resolving an async miss', async () => {
    let released = false
    requestUnknownModelRegistryRefresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          queueMicrotask(() => {
            released = true
            resolve(registry)
          })
        })
    )

    const { getModelContextWindow } = await import('./index')
    const pending = getModelContextWindow('brand-new-model')
    expect(released).toBe(false)
    await expect(pending).resolves.toBeNull()
    expect(released).toBe(true)
  })
})
