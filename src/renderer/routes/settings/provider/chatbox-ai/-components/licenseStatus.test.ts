import { describe, expect, it } from 'vitest'
import type { UserLicense, UserLicenseQuotaPack } from '@/packages/remote'
import { getAccountLicenseStatus, maskLicenseKey, sortAccountLicensesByStatus } from './licenseStatus'

const now = Date.parse('2026-09-15T00:00:00Z')
const day = 24 * 60 * 60 * 1000

function license(overrides: Partial<UserLicense> = {}): UserLicense {
  return {
    id: 1,
    key: 'license-key-000000000000',
    status: 'active',
    platform: 'stripe',
    product_name: 'Chatbox AI Pro',
    payment_type: 'subscription_monthly',
    image_usage: 0,
    image_limit: 100,
    unified_token_usage: 200,
    unified_token_limit: 1000,
    unified_token_usage_details: [],
    next_token_refresh_at: '',
    expires_at: new Date(now + 30 * day).toISOString(),
    created_at: '',
    recurring_canceled: false,
    quota_packs: [],
    ...overrides,
  }
}

function pack(overrides: Partial<UserLicenseQuotaPack> = {}): UserLicenseQuotaPack {
  return {
    id: 1,
    license_key: 'license-key-000000000000',
    product_name: 'Expansion Pack',
    quantity: 1,
    quota_limit: 500,
    quota_usage: 100,
    status: 'active',
    current_period_start: null,
    current_period_end: new Date(now + 60 * day).toISOString(),
    ...overrides,
  }
}

describe('getAccountLicenseStatus', () => {
  it('reports valid licenses with remaining quota', () => {
    expect(getAccountLicenseStatus(license(), now)).toMatchObject({
      kind: 'valid',
      usable: true,
      daysUntilExpiry: 30,
      quotaRemaining: 800,
      quotaLimit: 1000,
    })
    expect(getAccountLicenseStatus(license({ status: 'inactive', expires_at: '' }), now)).toMatchObject({
      kind: 'valid',
      daysUntilExpiry: null,
    })
  })

  it('warns when a usable license expires within seven days', () => {
    expect(
      getAccountLicenseStatus(license({ expires_at: new Date(now + 6.5 * day).toISOString() }), now)
    ).toMatchObject({ kind: 'expiring_soon', daysUntilExpiry: 7 })
    expect(getAccountLicenseStatus(license({ expires_at: new Date(now + 8 * day).toISOString() }), now).kind).toBe(
      'valid'
    )
  })

  it('marks exhausted quota unless an active expansion pack remains', () => {
    const exhausted = license({ unified_token_usage: 1000 })
    expect(getAccountLicenseStatus(exhausted, now).kind).toBe('quota_exhausted')
    expect(getAccountLicenseStatus({ ...exhausted, quota_packs: [pack()] }, now)).toMatchObject({
      kind: 'valid',
      expansionPackRemaining: 400,
    })
    const unusablePacks = [
      pack({ status: 'exhausted' }),
      pack({ current_period_end: new Date(now - day).toISOString() }),
    ]
    expect(getAccountLicenseStatus({ ...exhausted, quota_packs: unusablePacks }, now).kind).toBe('quota_exhausted')
  })

  it('surfaces refunds in progress ahead of quota and expiry warnings', () => {
    expect(
      getAccountLicenseStatus(
        license({ status: 'refunding', unified_token_usage: 1000, expires_at: new Date(now + day).toISOString() }),
        now
      )
    ).toMatchObject({ kind: 'refunding', usable: true })
  })

  it.each([
    [{ status: 'refunded' }, 'refunded'],
    [{ status: 'disabled' }, 'disabled'],
    [{ status: 'expired' }, 'expired'],
    [{ status: 'active', expires_at: new Date(now - day).toISOString() }, 'expired'],
    [{ status: 'unknown' }, 'unavailable'],
  ] as const)('marks %o as %s', (overrides, kind) => {
    expect(getAccountLicenseStatus(license(overrides), now)).toMatchObject({
      kind,
      usable: false,
      daysUntilExpiry: null,
    })
  })
})

describe('sortAccountLicensesByStatus', () => {
  it('lists usable licenses first and prefers later expiry within the same status', () => {
    const licenses = [
      license({ key: 'expired', status: 'expired' }),
      license({ key: 'soon', expires_at: new Date(now + 2 * day).toISOString() }),
      license({ key: 'short', expires_at: new Date(now + 20 * day).toISOString() }),
      license({ key: 'refunded', status: 'refunded' }),
      license({ key: 'long', expires_at: '' }),
      license({ key: 'empty', unified_token_usage: 1000 }),
    ]
    expect(sortAccountLicensesByStatus(licenses, now).map((item) => item.key)).toEqual([
      'long',
      'short',
      'soon',
      'empty',
      'expired',
      'refunded',
    ])
  })
})

describe('maskLicenseKey', () => {
  it('keeps the prefix and suffix that distinguish keys', () => {
    expect(maskLicenseKey('abcdefgh-1234-5678-wxyz')).toBe('abcdefgh••••wxyz')
    expect(maskLicenseKey('short-key')).toBe('short-ke••••')
  })
})

it.each(['active', 'expired'])('keeps expired %s licenses selectable with expansion points', (status) => {
  const usable = license({
    key: 'expansion',
    status,
    expires_at: new Date(now - day).toISOString(),
    quota_packs: [pack({ status: 'refunding' })],
  })
  expect(getAccountLicenseStatus(usable, now)).toMatchObject({
    kind: 'expired',
    usable: true,
    daysUntilExpiry: null,
    expansionPackRemaining: 400,
  })
  expect(
    sortAccountLicensesByStatus([license({ key: 'unusable', status: 'expired' }), usable], now).map((item) => item.key)
  ).toEqual(['expansion', 'unusable'])
})
