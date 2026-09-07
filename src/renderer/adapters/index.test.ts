import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@shared/models', () => ({
  getModel: vi.fn().mockReturnValue({
    name: 'test-model',
    modelId: 'test-model-id',
    isSupportVision: () => false,
    isSupportToolUse: () => false,
    isSupportSystemMessage: () => true,
    chat: vi.fn(),
    chatStream: vi.fn(),
    paint: vi.fn(),
  }),
}))

vi.mock('@/settings-runtime', () => ({
  settingsService: {
    getSettings: () => ({
      language: 'en',
      providers: {},
      theme: 'light',
    }),
    updateSettings: vi.fn(),
  },
}))

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    getConfig: vi.fn().mockResolvedValue({ uuid: 'test-uuid-12345' }),
    getPlatform: vi.fn().mockResolvedValue('darwin'),
    getVersion: vi.fn().mockResolvedValue('1.0.0'),
  },
}))

vi.mock('@/packages/navigator', () => ({
  getOS: () => 'macos',
}))

vi.mock('@shared/request/request', () => ({
  createAfetch: () => vi.fn().mockResolvedValue(new Response()),
}))

vi.mock('@/storage', () => ({
  default: {
    setBlob: vi.fn(),
    getBlob: vi.fn(),
  },
}))

vi.mock('@/storage/StoreStorage', () => ({
  StorageKeyGenerator: {
    picture: vi.fn().mockReturnValue('mock-storage-key'),
  },
}))

vi.mock('@/stores/settingActions', () => ({
  getRemoteConfig: vi.fn().mockReturnValue({}),
}))

vi.mock('@/utils/request', () => ({
  apiRequest: {
    post: vi.fn(),
    get: vi.fn(),
  },
}))

vi.mock('./sentry', () => {
  class MockRendererSentryAdapter {
    captureException = vi.fn()
    withScope = vi.fn()
  }
  return {
    RendererSentryAdapter: MockRendererSentryAdapter,
  }
})

import { getModel } from '@shared/models'
import type { SessionSettings } from '@shared/types'
import { createModel } from '@/adapters'
import platform from '@/platform'

function createTestSettings(overrides: SessionSettings = {}): SessionSettings {
  return {
    provider: 'openai',
    modelId: 'gpt-4',
    ...overrides,
  }
}

function getFirstGetModelCall() {
  const callArgs = vi.mocked(getModel).mock.calls.at(0)
  expect(callArgs).toBeDefined()
  if (!callArgs) {
    throw new Error('getModel was not called')
  }
  return callArgs
}

describe('createModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes settings through to getModel', async () => {
    const settings = createTestSettings({ temperature: 0.7 })

    await createModel(settings)

    expect(getModel).toHaveBeenCalledWith(settings, expect.any(Object), expect.any(Object), expect.any(Object))
    const callArgs = getFirstGetModelCall()
    expect(callArgs[0]).toBe(settings)
  })

  it('gets globalSettings from settingsStore', async () => {
    const settings = createTestSettings()

    await createModel(settings)

    expect(getModel).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        language: 'en',
        providers: {},
        theme: 'light',
      }),
      expect.any(Object),
      expect.any(Object)
    )
    const callArgs = getFirstGetModelCall()
    expect(callArgs[1]).toEqual({
      language: 'en',
      providers: {},
      theme: 'light',
    })
  })

  it('gets config from platform', async () => {
    const settings = createTestSettings()

    await createModel(settings)

    expect(platform.getConfig).toHaveBeenCalled()
    expect(getModel).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      { uuid: 'test-uuid-12345' },
      expect.any(Object)
    )
    const callArgs = getFirstGetModelCall()
    expect(callArgs[2]).toEqual({ uuid: 'test-uuid-12345' })
  })

  it('creates dependencies internally', async () => {
    const settings = createTestSettings()

    await createModel(settings)

    const callArgs = getFirstGetModelCall()
    const dependencies = callArgs[3]
    expect(dependencies).toBeDefined()
    expect(typeof dependencies).toBe('object')
    expect(dependencies).toHaveProperty('storage')
    expect(dependencies).toHaveProperty('request')
    expect(dependencies).toHaveProperty('sentry')
    expect(dependencies).toHaveProperty('getRemoteConfig')
  })

  it('returns the model instance from getModel', async () => {
    const settings = createTestSettings()

    const result = await createModel(settings)

    expect(result).toEqual({
      name: 'test-model',
      modelId: 'test-model-id',
      isSupportVision: expect.any(Function),
      isSupportToolUse: expect.any(Function),
      isSupportSystemMessage: expect.any(Function),
      chat: expect.any(Function),
      chatStream: expect.any(Function),
      paint: expect.any(Function),
    })
  })

  it('calls platform.getConfig before passing to getModel', async () => {
    const settings = createTestSettings()

    await createModel(settings)

    expect(platform.getConfig).toHaveBeenCalled()
    expect(getModel).toHaveBeenCalled()
  })

  it('handles async platform.getConfig correctly', async () => {
    const settings = createTestSettings()
    const mockConfig = { uuid: 'async-test-uuid' }
    vi.mocked(platform.getConfig).mockResolvedValueOnce(mockConfig)

    await createModel(settings)

    const callArgs = getFirstGetModelCall()
    expect(callArgs[2]).toEqual(mockConfig)
  })

  it('dependencies storage adapter has correct structure', async () => {
    const settings = createTestSettings()

    await createModel(settings)

    const callArgs = getFirstGetModelCall()
    const dependencies = callArgs[3]
    expect(dependencies.storage).toHaveProperty('saveImage')
    expect(dependencies.storage).toHaveProperty('getImage')
    expect(typeof dependencies.storage.saveImage).toBe('function')
    expect(typeof dependencies.storage.getImage).toBe('function')
  })

  it('dependencies request adapter has correct structure', async () => {
    const settings = createTestSettings()

    await createModel(settings)

    const callArgs = getFirstGetModelCall()
    const dependencies = callArgs[3]
    expect(dependencies.request).toHaveProperty('fetchWithOptions')
    expect(dependencies.request).toHaveProperty('apiRequest')
    expect(typeof dependencies.request.fetchWithOptions).toBe('function')
    expect(typeof dependencies.request.apiRequest).toBe('function')
  })

  it('dependencies sentry adapter is instantiated', async () => {
    const settings = createTestSettings()

    await createModel(settings)

    const callArgs = getFirstGetModelCall()
    const dependencies = callArgs[3]
    expect(dependencies.sentry).toBeDefined()
    expect(dependencies.sentry).toHaveProperty('captureException')
    expect(dependencies.sentry).toHaveProperty('withScope')
  })

  it('dependencies getRemoteConfig is a function', async () => {
    const settings = createTestSettings()

    await createModel(settings)

    const callArgs = getFirstGetModelCall()
    const dependencies = callArgs[3]
    expect(typeof dependencies.getRemoteConfig).toBe('function')
  })
})
