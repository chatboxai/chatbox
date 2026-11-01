// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { UserLicense } from '@/packages/remote'
import { fireEvent, render, screen } from '@/test-utils'
import { LicenseSelectionModal } from './LicenseSelectionModal'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })
  ),
})

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : key,
    i18n: { language: 'en' },
  }),
}))

const now = Date.parse('2026-09-15T00:00:00Z')
const day = 24 * 60 * 60 * 1000

function license(key: string, overrides: Partial<UserLicense> = {}): UserLicense {
  return {
    id: 1,
    key,
    status: 'active',
    platform: 'stripe',
    product_name: key,
    payment_type: 'subscription_monthly',
    image_usage: 0,
    image_limit: 100,
    unified_token_usage: 0,
    unified_token_limit: 1_000_000,
    unified_token_usage_details: [],
    next_token_refresh_at: '',
    expires_at: new Date(now + 60 * day).toISOString(),
    created_at: '',
    recurring_canceled: false,
    quota_packs: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})

afterEach(() => {
  vi.useRealTimers()
})

test('shows each license status and confirms the first usable license by default', () => {
  const onConfirm = vi.fn()
  render(
    <MantineProvider>
      <LicenseSelectionModal
        opened
        licenses={[
          license('Expired Trial', { status: 'expired', expires_at: new Date(now - day).toISOString() }),
          license('Monthly Plus', { unified_token_usage: 1_000_000 }),
          license('Yearly Pro', { recurring_canceled: true }),
          license('Weekly Lite', { expires_at: new Date(now + 3 * day).toISOString() }),
        ]}
        onConfirm={onConfirm}
      />
    </MantineProvider>
  )

  const statusOf = (name: string) =>
    screen.getByText(name).closest('[data-license-key]')?.querySelector('[data-license-status]')?.textContent
  expect(statusOf('Yearly Pro')).toBe('Valid')
  expect(statusOf('Weekly Lite')).toBe('Expires in 3 day(s)')
  expect(statusOf('Monthly Plus')).toBe('Quota used up')
  expect(statusOf('Expired Trial')).toBe('Expired')
  expect(screen.getByText(/Auto-renewal off/)).toBeTruthy()

  const order = Array.from(document.querySelectorAll('[data-license-key]')).map((item) =>
    item.getAttribute('data-license-key')
  )
  expect(order).toEqual(['Yearly Pro', 'Weekly Lite', 'Monthly Plus', 'Expired Trial'])

  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(onConfirm).toHaveBeenCalledWith('Yearly Pro')

  fireEvent.click(screen.getByText('Weekly Lite'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(onConfirm).toHaveBeenLastCalledWith('Weekly Lite')
})

test('omits the validity date for refunded licenses and trims whole quota numbers', () => {
  render(
    <MantineProvider>
      <LicenseSelectionModal
        opened
        licenses={[
          license('Refunded Pro', { status: 'refunded' }),
          license('Monthly Plus', { unified_token_usage: 300_000 }),
        ]}
        onConfirm={vi.fn()}
      />
    </MantineProvider>
  )

  const rowText = (name: string) => screen.getByText(name).closest('[data-license-key]')?.textContent ?? ''
  expect(rowText('Refunded Pro')).toContain('Refunded')
  expect(rowText('Refunded Pro')).not.toContain('Valid until')
  expect(rowText('Monthly Plus')).toContain('Quota left 700K/1M')
})

test('allows selecting an expired license with expansion points alongside a valid plan', () => {
  const onConfirm = vi.fn()
  render(
    <MantineProvider>
      <LicenseSelectionModal
        opened
        licenses={[
          license('Valid Pro'),
          license('Expansion Only', {
            status: 'expired',
            expires_at: new Date(now - day).toISOString(),
            quota_packs: [
              {
                id: 1,
                license_key: 'Expansion Only',
                product_name: 'Expansion',
                quantity: 1,
                status: 'active',
                quota_limit: 500,
                quota_usage: 100,
                current_period_start: null,
                current_period_end: new Date(now + day).toISOString(),
              },
            ],
          }),
        ]}
        onConfirm={onConfirm}
      />
    </MantineProvider>
  )
  const row = screen.getByText('Expansion Only').closest('[data-license-key]')
  expect(row?.textContent).toContain('Expansion pack left 400')
  expect(row?.textContent).not.toContain('Quota left')
  fireEvent.click(screen.getByText('Expansion Only'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(onConfirm).toHaveBeenCalledWith('Expansion Only')
})
