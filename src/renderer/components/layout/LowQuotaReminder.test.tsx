// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarLowQuotaReminder } from './LowQuotaReminder'

const mocks = vi.hoisted(() => ({
  getLicenseDetailRealtime: vi.fn(),
  settings: { licenseKey: 'active-key' },
  ui: { lowQuotaReminderDismissedPeriod: null as string | null },
}))

vi.mock('@/packages/remote', () => ({
  getLicenseDetailRealtime: mocks.getLicenseDetailRealtime,
  buildChatboxUrl: (path: string) => path,
}))
vi.mock('@/platform', () => ({ default: { openLink: vi.fn() } }))
vi.mock('@/stores/settingsStore', () => ({
  useLanguage: () => 'en',
  useSettingsStore: (selector: (state: typeof mocks.settings) => unknown) => selector(mocks.settings),
}))
vi.mock('@/stores/uiStore', () => ({
  uiStore: { setState: vi.fn() },
  useUIStore: (selector: (state: typeof mocks.ui) => unknown) => selector(mocks.ui),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

const lowQuota = {
  plan: 'pro_plus',
  unified_token_limit: 30_000_000,
  unified_token_usage: 29_900_000,
  remaining_quota_unified: 1 / 300,
  expansion_pack_limit: 0,
  expansion_pack_usage: 0,
  token_refreshed_time: '2026-10-01',
}

let client: QueryClient

function mount() {
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <SidebarLowQuotaReminder />
      </MantineProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.settings.licenseKey = 'active-key'
  mocks.ui.lowQuotaReminderDismissedPeriod = null
  mocks.getLicenseDetailRealtime.mockResolvedValue({ data: lowQuota })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})

afterEach(() => {
  cleanup()
  client.clear()
})

describe('SidebarLowQuotaReminder', () => {
  it.each([30_000_000, 30_000_001])('shows used-up points when usage is %i', async (usage) => {
    mocks.getLicenseDetailRealtime.mockResolvedValue({ data: { ...lowQuota, unified_token_usage: usage } })
    mount()
    expect(await screen.findByText('Your points are used up')).toBeTruthy()
    expect(screen.queryByText('Points running low')).toBeNull()
    expect(screen.getByText('0%')).toBeTruthy()
  })

  it('still shows running low when a positive balance rounds to 0%', async () => {
    mocks.getLicenseDetailRealtime.mockResolvedValue({ data: { ...lowQuota, unified_token_usage: 29_999_999 } })
    mount()
    expect(await screen.findByText('Points running low')).toBeTruthy()
    expect(screen.queryByText('Your points are used up')).toBeNull()
    expect(screen.getByText('0%')).toBeTruthy()
  })

  it('hides exhausted license points while expansion-pack points remain', async () => {
    mocks.getLicenseDetailRealtime.mockResolvedValue({
      data: { ...lowQuota, unified_token_usage: 30_000_001, expansion_pack_limit: 1 },
    })
    mount()
    await waitFor(() => expect(client.getQueryState(['sidebar-low-quota', 'active-key'])?.status).toBe('success'))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it.each([
    { expansion_pack_limit: 0, expansion_pack_usage: 0 },
    { expansion_pack_limit: 100_000, expansion_pack_usage: 100_000 },
    { expansion_pack_limit: 100_000, expansion_pack_usage: 100_001 },
  ])('shows low points when expansion-pack points are exhausted: %j', async (expansion) => {
    mocks.getLicenseDetailRealtime.mockResolvedValue({ data: { ...lowQuota, ...expansion } })
    mount()
    expect(await screen.findByText('Points running low')).toBeTruthy()
  })

  it.each([1, 100_000])('hides low points while %i expansion-pack points remain', async (remaining) => {
    mocks.getLicenseDetailRealtime.mockResolvedValue({
      data: { ...lowQuota, expansion_pack_limit: 200_000, expansion_pack_usage: 200_000 - remaining },
    })
    mount()
    await waitFor(() => expect(client.getQueryState(['sidebar-low-quota', 'active-key'])?.status).toBe('success'))
    expect(screen.queryByText('Points running low')).toBeNull()
  })

  it('hides the reminder above the threshold and retains the 10% boundary', async () => {
    mocks.getLicenseDetailRealtime.mockResolvedValue({ data: { ...lowQuota, unified_token_usage: 26_000_000 } })
    mount()
    await waitFor(() => expect(client.getQueryState(['sidebar-low-quota', 'active-key'])?.status).toBe('success'))
    expect(screen.queryByText('Points running low')).toBeNull()
    mocks.getLicenseDetailRealtime.mockResolvedValue({ data: { ...lowQuota, unified_token_usage: 27_000_000 } })
    act(() => client.getQueryCache().onFocus())
    expect(await screen.findByText('Points running low')).toBeTruthy()
  })

  it.each(['expansion', 'plan'])('immediately refreshes fresh quota on focus after buying a %s', async (purchase) => {
    mount()
    expect(await screen.findByText('Points running low')).toBeTruthy()
    const query = client.getQueryCache().find({ queryKey: ['sidebar-low-quota', 'active-key'] })
    expect(query?.isStaleByTime(30_000)).toBe(false)
    const purchased =
      purchase === 'expansion'
        ? { ...lowQuota, expansion_pack_limit: 100_000 }
        : { ...lowQuota, unified_token_limit: 60_000_000 }
    mocks.getLicenseDetailRealtime.mockResolvedValue({ data: purchased })
    act(() => client.getQueryCache().onFocus())
    await waitFor(() => expect(screen.queryByText('Points running low')).toBeNull())
    expect(mocks.getLicenseDetailRealtime).toHaveBeenCalledTimes(2)

    mocks.getLicenseDetailRealtime.mockResolvedValue({ data: lowQuota })
    act(() => client.getQueryCache().onFocus())
    expect(await screen.findByText('Points running low')).toBeTruthy()
  })

  it('keeps a dismissed reminder hidden for the current quota period', async () => {
    mocks.ui.lowQuotaReminderDismissedPeriod = `active-key:${lowQuota.token_refreshed_time}`
    mount()
    await waitFor(() => expect(client.getQueryState(['sidebar-low-quota', 'active-key'])?.status).toBe('success'))
    expect(screen.queryByText('Points running low')).toBeNull()
  })
})
