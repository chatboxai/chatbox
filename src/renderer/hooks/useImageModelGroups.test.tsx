/**
 * @vitest-environment jsdom
 */
import { ModelProviderEnum, type ProviderSettings } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode, StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadProviderImageModels: vi.fn(),
}))

vi.mock('@/packages/image-model-provider', () => ({ loadProviderImageModels: mocks.loadProviderImageModels }))
vi.mock('@/stores/queryClient', () => ({ queryClient: {} }))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { subscribe: vi.fn() },
  useLanguage: () => 'en',
  useSettingsStore: (selector: (state: { licenseKey: string }) => unknown) => selector({ licenseKey: '' }),
}))

import { useProviderImageModels } from './useImageModelGroups'

let testQueryClient: QueryClient

function createWrapper(strict = false) {
  return ({ children }: { children: ReactNode }) => {
    const queryProvider = createElement(QueryClientProvider, { client: testQueryClient }, children)
    return strict ? createElement(StrictMode, null, queryProvider) : queryProvider
  }
}

function modelForCredential(apiKey?: string) {
  return [{ modelId: apiKey || 'fallback', displayName: apiKey || 'Fallback' }]
}

describe('useProviderImageModels', () => {
  beforeEach(() => {
    testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.loadProviderImageModels
      .mockReset()
      .mockImplementation((_provider: ModelProviderEnum, options: { apiKey?: string }) =>
        Promise.resolve(modelForCredential(options.apiKey))
      )
  })

  afterEach(() => {
    testQueryClient.clear()
  })

  it('uses one query and fetch for the same settings object in StrictMode', async () => {
    const settings = { apiKey: 'strict-mode-credential' }
    const { result } = renderHook(() => useProviderImageModels(ModelProviderEnum.OpenRouter, true, settings), {
      wrapper: createWrapper(true),
    })

    await waitFor(() => {
      expect(result.current).toEqual(modelForCredential(settings.apiKey))
    })
    expect(mocks.loadProviderImageModels).toHaveBeenCalledTimes(1)
    expect(testQueryClient.getQueryCache().getAll()).toHaveLength(1)
  })

  it('shares one query and fetch across multiple hook instances with the same settings object', async () => {
    const settings = { apiKey: 'shared-credential' }
    const { result } = renderHook(
      () => [
        useProviderImageModels(ModelProviderEnum.OpenRouter, true, settings),
        useProviderImageModels(ModelProviderEnum.OpenRouter, true, settings),
      ],
      { wrapper: createWrapper(true) }
    )

    await waitFor(() => {
      expect(result.current).toEqual([modelForCredential(settings.apiKey), modelForCredential(settings.apiKey)])
    })
    expect(mocks.loadProviderImageModels).toHaveBeenCalledTimes(1)
    expect(testQueryClient.getQueryCache().getAll()).toHaveLength(1)
  })

  it('reuses the cached query when the same settings object is remounted', async () => {
    const settings = { apiKey: 'remount-credential' }
    const first = renderHook(() => useProviderImageModels(ModelProviderEnum.OpenRouter, true, settings), {
      wrapper: createWrapper(),
    })
    await waitFor(() => {
      expect(first.result.current).toEqual(modelForCredential(settings.apiKey))
    })
    first.unmount()

    const second = renderHook(() => useProviderImageModels(ModelProviderEnum.OpenRouter, true, settings), {
      wrapper: createWrapper(),
    })

    expect(second.result.current).toEqual(modelForCredential(settings.apiKey))
    expect(mocks.loadProviderImageModels).toHaveBeenCalledTimes(1)
  })

  it('preserves the selected remote model when ordinary provider settings change', async () => {
    const settings: ProviderSettings = { apiKey: 'unchanged-credential' }
    const { result, rerender } = renderHook(
      ({ settings }: { settings: ProviderSettings }) =>
        useProviderImageModels(ModelProviderEnum.OpenRouter, true, settings),
      { initialProps: { settings }, wrapper: createWrapper() }
    )
    await waitFor(() => expect(result.current).toEqual(modelForCredential(settings.apiKey)))
    const models = result.current
    rerender({ settings: { ...settings, models: [{ modelId: 'chat-model', nickname: 'Renamed model' }] } })
    expect(result.current).toBe(models)
    expect(mocks.loadProviderImageModels).toHaveBeenCalledTimes(1)
    expect(testQueryClient.getQueryCache().getAll()).toHaveLength(1)
  })

  it('drops cached capabilities immediately when a non-empty API key changes', async () => {
    const settingsA = { apiKey: 'openrouter-key-a' }
    const settingsB = { apiKey: 'openrouter-key-b' }
    let resolveSecondRequest: ((models: { modelId: string; displayName: string }[]) => void) | undefined
    mocks.loadProviderImageModels.mockImplementation((_provider: ModelProviderEnum, options: { apiKey?: string }) => {
      if (options.apiKey === settingsA.apiKey) {
        return Promise.resolve([
          {
            modelId: 'model-a',
            displayName: 'Model A',
            capabilities: { aspectRatio: { values: ['1:1'] }, inputReferences: null },
          },
        ])
      }
      return new Promise((resolve) => {
        resolveSecondRequest = resolve
      })
    })

    const { result, rerender } = renderHook(
      ({ settings }: { settings: ProviderSettings }) =>
        useProviderImageModels(ModelProviderEnum.OpenRouter, true, settings),
      { initialProps: { settings: settingsA }, wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current).toEqual([
        expect.objectContaining({
          modelId: 'model-a',
          capabilities: expect.objectContaining({ inputReferences: null }),
        }),
      ])
    })

    rerender({ settings: settingsB })

    expect(result.current).toEqual([])
    expect(mocks.loadProviderImageModels).toHaveBeenLastCalledWith(
      ModelProviderEnum.OpenRouter,
      expect.objectContaining({ apiKey: settingsB.apiKey })
    )
    const serializedQueryKeys = JSON.stringify(
      testQueryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey)
    )
    expect(serializedQueryKeys).not.toContain(settingsA.apiKey)
    expect(serializedQueryKeys).not.toContain(settingsB.apiKey)

    resolveSecondRequest?.([{ modelId: 'model-b', displayName: 'Model B' }])
    await waitFor(() => {
      expect(result.current).toEqual([expect.objectContaining({ modelId: 'model-b' })])
    })
  })

  it('assigns new opaque identities across logout, relogin, and credential reuse', async () => {
    const settingsA = { apiKey: 'rotating-credential-a' }
    const loggedOut = { apiKey: '' }
    const settingsAAfterLogin = { apiKey: settingsA.apiKey }
    const settingsB = { apiKey: 'rotating-credential-b' }
    const settingsAAfterRotation = { apiKey: settingsA.apiKey }

    const { result, rerender } = renderHook(
      ({ settings }: { settings: ProviderSettings }) =>
        useProviderImageModels(ModelProviderEnum.OpenRouter, true, settings),
      { initialProps: { settings: settingsA }, wrapper: createWrapper() }
    )

    for (const settings of [settingsA, loggedOut, settingsAAfterLogin, settingsB, settingsAAfterRotation]) {
      if (settings !== settingsA) {
        rerender({ settings })
        expect(result.current).toEqual([])
      }
      await waitFor(() => {
        expect(result.current).toEqual(modelForCredential(settings.apiKey))
      })
    }

    expect(mocks.loadProviderImageModels).toHaveBeenCalledTimes(5)
    const queryKeys = testQueryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey)
    expect(queryKeys).toHaveLength(5)
    expect(new Set(queryKeys.map((key) => key[3])).size).toBe(5)
    const serializedQueryKeys = JSON.stringify(queryKeys)
    expect(serializedQueryKeys).not.toContain(settingsA.apiKey)
    expect(serializedQueryKeys).not.toContain(settingsB.apiKey)
  })
})
