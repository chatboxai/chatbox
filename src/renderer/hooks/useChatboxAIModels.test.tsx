// @vitest-environment jsdom
import type { ProviderSettings } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isChatboxAIModelLocked } from '@/components/ModelSelectorV2/chatboxCatalog'
import type { ChatboxAIModelList } from '@/packages/remote'
import { useLicenseActivation } from '@/routes/settings/provider/chatbox-ai/-components/useLicenseActivation'
import useChatboxAIModels, { useRefreshChatboxAIModelsOnLicenseChange } from './useChatboxAIModels'

const mocks = vi.hoisted(() => ({
  getModelManifest: vi.fn(),
  getChatboxAIModelList: vi.fn(),
  setProviderSettings: vi.fn(),
  getLicenseDetailRealtime: vi.fn(),
  settings: { licenseKey: 'active-key' },
}))

vi.mock('@/packages/remote', () => ({
  getModelManifest: mocks.getModelManifest,
  getChatboxAIModelList: mocks.getChatboxAIModelList,
  getLicenseDetailRealtime: mocks.getLicenseDetailRealtime,
}))
vi.mock('@/stores/premiumActions', () => ({ useAutoValidate: () => true }))
vi.mock('@/stores/settingsStore', () => ({
  useLanguage: () => 'en',
  useSettingsStore: (selector: (state: typeof mocks.settings) => unknown) => selector(mocks.settings),
  useProviderSettings: () => ({
    providerSettings: {} as ProviderSettings,
    setProviderSettings: mocks.setProviderSettings,
  }),
}))

type Detail = Parameters<typeof useRefreshChatboxAIModelsOnLicenseChange>[1]
const freeDetail: Detail = { name: 'Chatbox AI Free', plan: 'free' }
const proDetail: Detail = { name: 'Chatbox AI Pro', plan: 'pro' }
const queryKey = ['chatbox-ai-models', 'en', 'active-key']

function catalog(plan: string): ChatboxAIModelList {
  return {
    provider: { id: 'chatbox-ai', name: 'Chatbox AI' },
    license: { plan },
    groups: [{ id: 'advanced', modelIds: [] }],
    models: {},
    imageModels: [],
  }
}

let client: QueryClient
let serverPlan: string

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children)
}

function mount(detail: Detail = freeDetail, licenseKey = 'active-key') {
  return renderHook(
    (props: { detail: Detail; licenseKey: string }) => {
      const models = useChatboxAIModels()
      useRefreshChatboxAIModelsOnLicenseChange(props.licenseKey, props.detail)
      return {
        ...models,
        locked: isChatboxAIModelLocked('advanced', models.chatboxAIModelList?.license.plan),
      }
    },
    { wrapper, initialProps: { detail, licenseKey } }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  serverPlan = 'free'
  mocks.settings.licenseKey = 'active-key'
  mocks.getModelManifest.mockResolvedValue({ models: [], imageModels: [] })
  mocks.getChatboxAIModelList.mockImplementation(async () => catalog(serverPlan))
})

afterEach(() => {
  cleanup()
  client.clear()
})

describe('Chatbox AI entitlement refresh', () => {
  it('preserves image model descriptions for the image picker', async () => {
    mocks.getModelManifest.mockResolvedValue({
      models: [],
      imageModels: [{ modelId: 'image', modelName: 'Image', description: 'Localized description' }],
    })
    const { result } = mount()
    await waitFor(() =>
      expect(result.current.chatboxAIImageModels).toEqual([
        expect.objectContaining({ modelId: 'image', nickname: 'Image', description: 'Localized description' }),
      ])
    )
  })

  it('unlocks a fresh cached catalog when the same key upgrades and relocks after a downgrade', async () => {
    const { result, rerender } = mount()
    await waitFor(() => expect(result.current.chatboxAIModelList?.license.plan).toBe('free'))
    expect(result.current.locked).toBe(true)
    const requests = mocks.getChatboxAIModelList.mock.calls.length

    serverPlan = 'pro'
    rerender({ detail: proDetail, licenseKey: 'active-key' })
    await waitFor(() => expect(result.current.locked).toBe(false))
    expect(mocks.getChatboxAIModelList).toHaveBeenCalledTimes(requests + 1)

    serverPlan = 'lite'
    rerender({ detail: { name: 'Chatbox AI Lite', plan: 'lite' }, licenseKey: 'active-key' })
    await waitFor(() => expect(result.current.chatboxAIModelList?.license.plan).toBe('lite'))
    expect(result.current.locked).toBe(true)
  })

  it('refreshes on app focus even while the model cache is fresh', async () => {
    const { result } = mount(null)
    await waitFor(() => expect(result.current.chatboxAIModelList?.license.plan).toBe('free'))
    serverPlan = 'pro'
    act(() => client.getQueryCache().onFocus())
    await waitFor(() => expect(result.current.locked).toBe(false))
  })

  it('rechecks access when the license becomes disabled without changing its plan', async () => {
    serverPlan = 'pro'
    const { result, rerender } = mount({ ...proDetail, status: 'active' })
    await waitFor(() => expect(result.current.locked).toBe(false))
    serverPlan = 'free'
    rerender({ detail: { ...proDetail, status: 'disabled' }, licenseKey: 'active-key' })
    await waitFor(() => expect(result.current.locked).toBe(true))
  })

  it('refreshes model access after the manual-key detail query receives an upgrade', async () => {
    mocks.getLicenseDetailRealtime.mockResolvedValue({ data: freeDetail })
    const { result } = renderHook(
      () => {
        useLicenseActivation({
          settings: {
            licenseKey: 'active-key',
            memorizedManualLicenseKey: 'active-key',
            licenseInstances: { 'active-key': 'instance' },
            licenseActivationMethod: 'manual',
          },
        })
        return useChatboxAIModels()
      },
      { wrapper }
    )
    await waitFor(() => expect(result.current.chatboxAIModelList?.license.plan).toBe('free'))
    serverPlan = 'pro'
    mocks.getLicenseDetailRealtime.mockResolvedValue({ data: proDetail })
    await act(async () => {
      await client.refetchQueries({ queryKey: ['license-detail', 'active-key'] })
    })
    await waitFor(() => expect(result.current.chatboxAIModelList?.license.plan).toBe('pro'))
  })

  it('does not refetch for quota-only detail updates or another selected key', async () => {
    const { result, rerender } = mount()
    await waitFor(() => expect(result.current.chatboxAIModelList?.license.plan).toBe('free'))
    const requests = mocks.getChatboxAIModelList.mock.calls.length
    const quotaUpdate = { ...freeDetail, unified_token_usage: 123 }
    rerender({ detail: quotaUpdate, licenseKey: 'active-key' })
    rerender({ detail: proDetail, licenseKey: 'other-key' })
    await act(async () => {})
    expect(mocks.getChatboxAIModelList).toHaveBeenCalledTimes(requests)
    expect(result.current.locked).toBe(true)
  })

  it('invalidates inactive language variants only for the active key', async () => {
    const zhKey = ['chatbox-ai-models', 'zh-Hans', 'active-key']
    const otherKey = ['chatbox-ai-models', 'en', 'other-key']
    for (const key of [queryKey, zhKey, otherKey]) client.setQueryData(key, { modelList: catalog('free') })
    renderHook(() => useRefreshChatboxAIModelsOnLicenseChange('active-key', proDetail), { wrapper })
    await waitFor(() => expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true))
    expect(client.getQueryState(zhKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false)
  })

  it('discards an initial catalog response started before the plan changed', async () => {
    let resolveOldCatalog!: (value: ChatboxAIModelList) => void
    mocks.getChatboxAIModelList.mockImplementationOnce(
      () =>
        new Promise<ChatboxAIModelList>((resolve) => {
          resolveOldCatalog = resolve
        })
    )
    const { result, rerender } = mount(null)
    await waitFor(() => expect(mocks.getChatboxAIModelList).toHaveBeenCalledTimes(1))
    serverPlan = 'pro'
    rerender({ detail: proDetail, licenseKey: 'active-key' })
    await waitFor(() => expect(result.current.locked).toBe(false))
    await act(async () => resolveOldCatalog(catalog('free')))
    expect(result.current.chatboxAIModelList?.license.plan).toBe('pro')
  })

  it('keeps server access authoritative when a detail refresh triggers a failed catalog request', async () => {
    const { result, rerender } = mount()
    await waitFor(() => expect(result.current.chatboxAIModelList?.license.plan).toBe('free'))
    mocks.getModelManifest.mockRejectedValueOnce(new Error('offline'))
    rerender({ detail: proDetail, licenseKey: 'active-key' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.locked).toBe(true)
  })
})
