// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'jotai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatboxAIModelList } from '@/packages/remote'
import { ModelSelectorV2 } from './index'

const state = vi.hoisted(() => ({ mobile: true, catalog: null as ChatboxAIModelList | null }))
const settings = {
  licenseKey: 'trial-fixture',
  favoritedModels: [],
  providers: {} as Record<string, { excludedModels?: string[] }>,
}
const ui = { modelSelectorTab: 'all', setModelSelectorTab: () => undefined }

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => state.mobile }))
vi.mock('@/hooks/useChatboxAIModels', () => ({
  default: () => ({ chatboxAIModelList: state.catalog, chatboxAIModels: [] }),
}))
vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({
    providers: [],
    favoritedModels: [],
    favoriteModel: vi.fn(),
    unfavoriteModel: vi.fn(),
    isFavoritedModel: () => false,
  }),
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: <T,>(select: (value: typeof settings) => T) => select(settings),
}))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: <T,>(select: (value: typeof ui) => T) => select(ui),
}))
vi.mock('@/stores/authInfoStore', () => ({
  useAuthInfoStore: <T,>(select: (value: { accessToken: string; refreshToken: string }) => T) =>
    select({ accessToken: 'fixture', refreshToken: 'fixture' }),
}))
vi.mock('@/stores/atoms/uiAtoms', () => ({ collapsedProvidersAtom: atom({}) }))
vi.mock('@/analytics/model-selection', () => ({
  trackListModelClick: vi.fn(),
  trackProTrialClaimClick: vi.fn(),
  trackSelectModelClick: vi.fn(),
  trackUpgradeModelClick: vi.fn(),
  trackProTrialUpgradeClick: vi.fn(),
}))
vi.mock('@/packages/remote', () => ({ recordAdvancedModelListClick: vi.fn() }))
vi.mock('@/platform', () => ({ default: { openLink: vi.fn() } }))
vi.mock('./DetailCard', () => ({ DetailCard: () => null }))
vi.mock('./GenericProviderRows', () => ({ GenericProviderRows: () => null }))
vi.mock('./ProviderRowHeader', () => ({ ProviderRowHeader: () => null }))
vi.mock('./ModelRow', () => ({
  ModelRow: ({ detail, locked, onSelect }: { detail: { name: string }; locked: boolean; onSelect: () => void }) => (
    <button data-locked={String(locked)} onClick={onSelect}>
      {detail.name}
    </button>
  ),
}))

const startsAt = '2026-11-13T07:00:00Z'
const expiresAt = '2026-11-20T07:00:00Z'

beforeEach(() => {
  vi.setSystemTime(Date.parse(startsAt) - 1000)
  state.catalog = {
    provider: { id: 'chatbox-ai', name: 'Chatbox AI' },
    license: { plan: 'lite', proTrial: { canClaim: false, startsAt, expiresAt } },
    imageModels: [],
    groups: [{ id: 'advanced', modelIds: ['advanced-one', 'advanced-two'], featuredModelIds: ['advanced-one'] }],
    models: Object.fromEntries(
      ['advanced-one', 'advanced-two'].map((modelId) => [
        modelId,
        {
          modelId,
          modelName: modelId,
          costLevel: '',
          description: '',
          access: { available: true },
        },
      ])
    ),
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }),
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Pro trial model selector', () => {
  it.each([true, false])('unlocks advanced models when opening after trial start, mobile=%s', (mobile) => {
    state.mobile = mobile
    const onSelect = vi.fn()
    render(
      <MantineProvider>
        <ModelSelectorV2 onSelect={onSelect}>
          <button>Choose model</button>
        </ModelSelectorV2>
      </MantineProvider>
    )
    vi.setSystemTime(Date.parse(startsAt) + 1000)
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }))
    expect(screen.queryByText('On trial: ends {{time}}')).not.toBeNull()
    expect(screen.queryByText('Upgrade to Pro')).toBeNull()
    expect(screen.getByRole('button', { name: 'advanced-one' }).getAttribute('data-locked')).toBe('false')
    expect(screen.getByRole('button', { name: 'advanced-two' }).getAttribute('data-locked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'advanced-two' }))
    expect(onSelect).toHaveBeenCalledWith('chatbox-ai', 'advanced-two')
  })
  it.each([true, false])('restores the upgrade entry when opening after trial expiry, mobile=%s', (mobile) => {
    state.mobile = mobile
    vi.setSystemTime(Date.parse(startsAt) + 1000)
    render(
      <MantineProvider>
        <ModelSelectorV2>
          <button>Choose model</button>
        </ModelSelectorV2>
      </MantineProvider>
    )
    vi.setSystemTime(Date.parse(expiresAt) + 1000)
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }))
    expect(screen.queryByText('On trial: ends {{time}}')).toBeNull()
    expect(screen.queryByText('Upgrade to Pro')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'advanced-one' }).getAttribute('data-locked')).toBe('true')
    expect(screen.queryByRole('button', { name: 'advanced-two' })).toBeNull()
  })
})
