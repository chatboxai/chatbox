import { describe, expect, it } from 'vitest'
import {
  selectAccountLicenseForInspection,
  accountLicenseFromApi,
  getAccountLicenseStatus,
  isAccountLicenseUsable,
} from './account-license'

describe('isAccountLicenseUsable', () => {
  const now = Date.parse('2026-09-11T00:00:00Z')
  it.each(['active', 'inactive', 'refunding'])('accepts usable %s licenses', (status) => {
    expect(isAccountLicenseUsable(status, null, [], now)).toBe(true)
    expect(isAccountLicenseUsable(status, '2027-01-01', [], now)).toBe(true)
  })
  it.each(['expired', 'disabled', 'refunded', ''])('rejects %s licenses', (status) => {
    expect(isAccountLicenseUsable(status, null, [], now)).toBe(false)
  })
  it.each(['2025-01-01', '2026-09-11T00:00:00Z', 'invalid'])('rejects expired or invalid dates: %s', (date) => {
    expect(isAccountLicenseUsable('active', date, [], now)).toBe(false)
  })
})

const pack = { status: 'active', quota_limit: 100, quota_usage: 20, current_period_end: '2027-01-01' }
const now = Date.parse('2026-09-11T00:00:00Z')
it.each(['active', 'inactive', 'refunding', 'expired'])(
  'accepts expired %s licenses with usable expansion points',
  (status) => {
    expect(isAccountLicenseUsable(status, '2020-01-01', [pack], now)).toBe(true)
  }
)
it.each([
  { ...pack, quota_usage: 100 },
  { ...pack, status: 'refunded' },
  { ...pack, status: 'expired' },
  { ...pack, status: 'exhausted' },
  { ...pack, current_period_end: '2026-09-11T00:00:00Z' },
  { ...pack, current_period_end: null },
  { ...pack, current_period_end: 'invalid' },
  null,
])('rejects an expired license with an unusable pack: %j', (unusable) => {
  expect(isAccountLicenseUsable('active', '2020-01-01', [unusable], now)).toBe(false)
})
it.each(['disabled', 'refunded'])('uses expansion packs independently of the %s plan status', (status) => {
  expect(isAccountLicenseUsable(status, '2020-01-01', [pack], now)).toBe(true)
  expect(isAccountLicenseUsable(status, '2027-01-01', [{ ...pack, quota_usage: 100 }], now)).toBe(false)
  expect(
    getAccountLicenseStatus({ key: status, status, expiresAt: '2027-01-01', quotaPacks: [pack] }, now)
  ).toMatchObject({ usable: true, kind: status, daysUntilExpiry: null })
})
it('accepts refunding packs and skips unusable packs', () => {
  expect(isAccountLicenseUsable('active', '2020-01-01', [null, { ...pack, status: 'refunding' }], now)).toBe(true)
})

// The API DTO and native account DTO must yield the same selection and ordering.
it('shares candidate priority across API and native account data', async () => {
  const { accountLicenseFromApi, selectAccountLicense } = await import('./account-license')
  const api = [
    { key: 'expired-pack', status: 'expired', expires_at: '2020-01-01', quota_packs: [pack] },
    { key: 'disabled', status: 'disabled' },
    { key: 'valid', status: 'active', expires_at: '2027-01-01' },
  ]
  const native = api.map(accountLicenseFromApi)
  const choose = (settings = {}) => selectAccountLicense(native, settings, 'user@example.com', false, now)
  expect(choose().eligible.map((license) => license.key)).toEqual(['valid', 'expired-pack'])
  expect(choose().selected?.key).toBe('valid')
  expect(choose({ lastSelectedLicenseByUser: { 'user@example.com': 'expired-pack' } }).selected?.key).toBe(
    'expired-pack'
  )
  expect(
    choose({ licenseKey: 'valid', licenseActivationMethod: 'login', licenseInstances: { valid: 'instance' } })
      .needsActivation
  ).toBe(false)
  expect(choose({ licenseKey: 'valid', licenseActivationMethod: 'login' }).needsActivation).toBe(true)
})

it('preserves manual credentials during refresh and selects an account key after explicit login', async () => {
  const { selectAccountLicense } = await import('./account-license')
  const settings = { licenseKey: 'manual', licenseActivationMethod: 'manual' as const }
  const licenses = [{ key: 'account', status: 'active' }]
  expect(selectAccountLicense(licenses, settings, 'user', false, now).preserveManual).toBe(true)
  expect(selectAccountLicense(licenses, settings, 'user', true, now)).toMatchObject({
    preserveManual: false,
    needsActivation: true,
    selected: { key: 'account' },
  })
})

it.each(['free', 'lemonsqueezy'])('keeps %s date handling consistent with backend status', (platform) => {
  const active = accountLicenseFromApi({ key: 'key', platform, status: 'active', expires_at: '2020-01-01' })
  expect(getAccountLicenseStatus(active).usable).toBe(true)
  expect(getAccountLicenseStatus(active).kind).toBe('valid')
  expect(getAccountLicenseStatus(active).expiryDate).toBeNull()
  expect(getAccountLicenseStatus({ ...active, status: 'expired' }).usable).toBe(false)
  expect(getAccountLicenseStatus({ ...active, status: 'disabled' }).usable).toBe(false)
})

it('retains an account-owned inspection selection after credentials are cleared', () => {
  const licenses = [
    { key: 'expired', status: 'expired' },
    { key: 'disabled', status: 'disabled' },
  ]
  expect(selectAccountLicenseForInspection(licenses, ['disabled', undefined])?.key).toBe('disabled')
  expect(selectAccountLicenseForInspection(licenses, ['foreign-key'])?.key).toBe('expired')
  expect(selectAccountLicenseForInspection([], ['foreign-key'])).toBeUndefined()
})

it('rejects unknown license states even with a valid expansion pack', () => {
  expect(isAccountLicenseUsable('unknown', null, [pack], now)).toBe(false)
})
