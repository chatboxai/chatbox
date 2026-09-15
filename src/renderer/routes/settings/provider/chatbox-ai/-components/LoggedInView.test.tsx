// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { UserLicense } from '@/packages/remote'
import type { Settings } from '@shared/types'
import { LoggedInView } from './LoggedInView'

const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  settings: {} as Partial<Settings>,
  listeners: new Set<() => void>(),
}))
vi.mock('@/analytics/jk', () => ({ trackJkClickEvent: vi.fn() }))
vi.mock('@/packages/event', () => ({ trackingEvent: vi.fn() }))
vi.mock('@/packages/openLinkWithAuth', () => ({ openLinkWithAuth: vi.fn() }))
vi.mock('@/packages/remote', () => ({
  buildChatboxUrl: () => '',
  getLicenseDetailRealtime: vi.fn(),
  getLicenseDetailForInspection: vi.fn(),
  getUserProfile: vi.fn(),
  listLicensesByUser: vi.fn(),
}))
vi.mock('@/platform', () => ({ default: { type: 'desktop' } }))
vi.mock('@/stores/premiumActions', () => ({ activate: mocks.activate }))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: Partial<Settings>) => unknown) =>
    selector(
      useSyncExternalStore(
        (listener) => {
          mocks.listeners.add(listener)
          return () => {
            mocks.listeners.delete(listener)
          }
        },
        () => mocks.settings
      )
    ),
  settingsStore: {
    getState: () => mocks.settings,
    setState: (update: Partial<Settings> | ((state: Partial<Settings>) => Partial<Settings>)) => {
      mocks.settings = { ...mocks.settings, ...(typeof update === 'function' ? update(mocks.settings) : update) }
      mocks.listeners.forEach((listener) => listener())
    },
  },
}))
vi.mock('./LicenseDetailCard', () => ({ LicenseDetailCard: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
Object.defineProperty(window, 'matchMedia', {
  value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
})

function license(key: string, status = 'active', expires_at = ''): UserLicense {
  return {
    key,
    status,
    expires_at,
    id: 1,
    platform: 'stripe',
    product_name: key,
    payment_type: 'subscription',
    image_usage: 0,
    image_limit: 1,
    unified_token_usage: 0,
    unified_token_limit: 100,
    unified_token_usage_details: [],
    next_token_refresh_at: '',
    created_at: '',
    recurring_canceled: false,
    quota_packs: [],
  }
}
function mount(licenses: UserLicense[], onShowLicenseSelectionModal = vi.fn(), afterLogin = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <LoggedInView
          afterLogin={afterLogin}
          language="en"
          onLogout={() => {}}
          onSwitchToLicenseKey={() => {}}
          onShowLicenseSelectionModal={onShowLicenseSelectionModal}
          initialAccountData={{ userProfile: { email: 'user@example.com', id: 'user', created_at: '' }, licenses }}
        />
      </QueryClientProvider>
    </MantineProvider>
  )
  return onShowLicenseSelectionModal
}
beforeEach(() => {
  mocks.settings = {
    licenseKey: 'expired',
    licenseActivationMethod: 'login',
    licenseInstances: { expired: 'instance' },
    lastSelectedLicenseByUser: { 'user@example.com': 'expired' },
  }
  mocks.activate.mockReset().mockResolvedValue({ valid: true })
})
afterEach(cleanup)
it('automatically activates the only usable license instead of an expired remembered key', async () => {
  const modal = mount([license('expired', 'active', '2020-01-01'), license('valid', 'inactive')])
  await waitFor(() =>
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith('valid', 'login', { accountEmail: 'user@example.com' })
  )
  expect(modal).not.toHaveBeenCalled()
})
it('offers only eligible licenses when multiple choices remain', () => {
  const modal = mount([license('expired', 'expired'), license('one'), license('two')])
  expect(modal).toHaveBeenCalledOnce()
  expect(modal.mock.calls[0][0].licenses.map((item: UserLicense) => item.key)).toEqual(['one', 'two'])
})
it('keeps the current activated usable license', () => {
  mocks.settings.licenseKey = 'valid'
  mocks.settings.licenseInstances = { valid: 'instance' }
  mount([license('valid'), license('other')])
  expect(mocks.activate).not.toHaveBeenCalled()
})
it('does not activate invalid licenses when no usable key remains', () => {
  const modal = mount([license('expired', 'expired'), license('disabled', 'disabled')])
  expect(mocks.activate).not.toHaveBeenCalled()
  expect(modal).not.toHaveBeenCalled()
})
it('uses the valid remembered key among multiple licenses', async () => {
  mocks.settings.lastSelectedLicenseByUser = { 'user@example.com': 'two' }
  const modal = mount([license('expired', 'expired'), license('one'), license('two')])
  await waitFor(() =>
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith('two', 'login', { accountEmail: 'user@example.com' })
  )
  expect(modal).not.toHaveBeenCalled()
})
it('falls back to a usable key when the selection dialog is canceled', async () => {
  const modal = mount([license('expired', 'expired'), license('one'), license('two')])
  modal.mock.calls[0][0].onCancel()
  await waitFor(() =>
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith('one', 'login', { accountEmail: 'user@example.com' })
  )
})

it('automatically activates an expired license with expansion points', async () => {
  mocks.settings = { licenseInstances: {} }
  const modal = mount([
    {
      ...license('expansion', 'expired', '2020-01-01'),
      quota_packs: [{ status: 'active', quota_limit: 100, quota_usage: 20, current_period_end: '2099-01-01' }],
    },
  ])
  await waitFor(() =>
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith('expansion', 'login', { accountEmail: 'user@example.com' })
  )
  expect(modal).not.toHaveBeenCalled()
})

it('does not auto-activate during a manual account license switch', async () => {
  mocks.settings = { licenseKey: 'one', licenseActivationMethod: 'login', licenseInstances: { one: 'instance' } }
  let complete: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    complete = resolve
  })
  mocks.activate.mockImplementation(async (key: string) => {
    mocks.settings = { ...mocks.settings, licenseKey: '', licenseActivationMethod: undefined }
    mocks.listeners.forEach((listener) => listener())
    await pending
    mocks.settings = {
      ...mocks.settings,
      licenseKey: key,
      licenseActivationMethod: 'login',
      licenseInstances: { [key]: 'instance' },
    }
    mocks.listeners.forEach((listener) => listener())
    return { valid: true }
  })
  mount([license('one'), license('two')])
  fireEvent.click(screen.getByRole('textbox'))
  fireEvent.click(screen.getAllByRole('option')[1])
  await act(async () => {
    await Promise.resolve()
  })
  const calls = mocks.activate.mock.calls.length
  await act(async () => {
    complete?.()
    await pending
  })
  expect(calls).toBe(1)
  expect(mocks.activate).toHaveBeenCalledExactlyOnceWith('two', 'login', { accountEmail: 'user@example.com' })
})

it('keeps an activated expired account license visible when no usable key remains', () => {
  const modal = mount([license('expired', 'expired', '2020-01-01')])
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toContain('expired')
  expect(mocks.activate).not.toHaveBeenCalled()
  expect(modal).not.toHaveBeenCalled()
})

it('preserves a manual key on refresh but switches after explicit account login', async () => {
  mocks.settings = { licenseKey: 'manual', licenseActivationMethod: 'manual', licenseInstances: { manual: 'instance' } }
  mount([license('account')])
  expect(mocks.activate).not.toHaveBeenCalled()
  cleanup()
  mount([license('account')], vi.fn(), true)
  await waitFor(() =>
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith('account', 'login', { accountEmail: 'user@example.com' })
  )
})

it('keeps unavailable license details selected after validation clears the active key', async () => {
  mocks.settings = {
    licenseKey: 'expired',
    licenseActivationMethod: 'login',
    licenseInstances: { expired: 'instance' },
  }
  mount([license('expired', 'expired'), license('disabled', 'disabled')])
  await act(async () => {
    mocks.settings = { licenseKey: '', licenseInstances: {} }
    mocks.listeners.forEach((listener) => listener())
  })
  expect((screen.getByPlaceholderText('Select a license') as HTMLInputElement).value).toContain('expired')
  expect(screen.getByText('This license is not active. You can still view its details.')).toBeTruthy()
  fireEvent.click(screen.getByPlaceholderText('Select a license'))
  fireEvent.click(screen.getByRole('option', { name: /disabled/i }))
  expect((screen.getByPlaceholderText('Select a license') as HTMLInputElement).value).toContain('disabled')
  expect(mocks.activate).not.toHaveBeenCalled()
  expect(mocks.settings.licenseKey).toBe('')
})
