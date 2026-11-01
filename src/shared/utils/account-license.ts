import type { Settings } from '../types'

/** Remaining points in expansion packs accepted by the backend. */
export function getAccountExpansionPackRemaining(quotaPacks: readonly unknown[] = [], now = Date.now()): number {
  return quotaPacks.reduce<number>((remaining, candidate) => {
    if (!candidate || typeof candidate !== 'object') return remaining
    const pack = candidate as Record<string, unknown>
    if (pack.status !== 'active' && pack.status !== 'refunding') return remaining
    if (typeof pack.current_period_end !== 'string' || !(Date.parse(pack.current_period_end) > now)) return remaining
    if (typeof pack.quota_limit !== 'number' || typeof pack.quota_usage !== 'number') return remaining
    if (!Number.isFinite(pack.quota_limit) || !Number.isFinite(pack.quota_usage)) return remaining
    return remaining + Math.max(pack.quota_limit - pack.quota_usage, 0)
  }, 0)
}

/** Account licenses can be activated before their first device is registered. */
export function isAccountLicenseUsable(
  status: string,
  expiresAt: string | null | undefined,
  quotaPacks: readonly unknown[] = [],
  now = Date.now(),
  platform?: string
): boolean {
  if (status === 'expired' || status === 'disabled' || status === 'refunded')
    return getAccountExpansionPackRemaining(quotaPacks, now) > 0
  if (status !== 'active' && status !== 'inactive' && status !== 'refunding') return false
  return (
    ignoresLicenseExpiryDate(platform) ||
    !expiresAt ||
    new Date(expiresAt).getTime() > now ||
    getAccountExpansionPackRemaining(quotaPacks, now) > 0
  )
}

export interface AccountLicenseSummary {
  key: string
  status: string
  platform?: string
  expiresAt?: string | null
  quotaPacks?: readonly unknown[]
  unifiedTokenLimit?: number
  unifiedTokenUsage?: number
}

/** Adapter for the account API's snake-case DTO. Native hosts already use AccountLicenseSummary. */
export function accountLicenseFromApi(license: {
  key: string
  status: string
  platform?: string
  expires_at?: string | null
  quota_packs?: readonly unknown[]
  unified_token_limit?: number
  unified_token_usage?: number
}): AccountLicenseSummary {
  return {
    key: license.key,
    status: license.status,
    platform: license.platform,
    expiresAt: license.expires_at,
    quotaPacks: license.quota_packs,
    unifiedTokenLimit: license.unified_token_limit,
    unifiedTokenUsage: license.unified_token_usage,
  }
}

export type AccountLicenseStatusKind =
  | 'valid'
  | 'expiring_soon'
  | 'quota_exhausted'
  | 'refunding'
  | 'expired'
  | 'disabled'
  | 'refunded'
  | 'unavailable'

export interface AccountLicenseStatus {
  kind: AccountLicenseStatusKind
  usable: boolean
  /** Whole days left before expiry, rounded up; null when the license never expires or is already expired. */
  daysUntilExpiry: number | null
  /** Date enforced by the entitlement policy; provider-managed dates are omitted. */
  expiryDate: string | null
  quotaRemaining: number
  quotaLimit: number
  expansionPackRemaining: number
}

export const EXPIRING_SOON_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

const STATUS_ORDER: Record<AccountLicenseStatusKind, number> = {
  valid: 0,
  expiring_soon: 1,
  refunding: 2,
  quota_exhausted: 3,
  expired: 4,
  disabled: 5,
  refunded: 6,
  unavailable: 7,
}

function ignoresLicenseExpiryDate(platform?: string): boolean {
  return platform === 'free' || platform === 'lemonsqueezy'
}

function licenseExpiryTime(license: AccountLicenseSummary): number | null {
  return !ignoresLicenseExpiryDate(license.platform) && license.expiresAt ? Date.parse(license.expiresAt) : null
}

function getUnusableKind(license: AccountLicenseSummary, now: number): AccountLicenseStatusKind {
  if (license.status === 'refunded') return 'refunded'
  if (license.status === 'disabled') return 'disabled'
  const expiresAt = licenseExpiryTime(license)
  if (license.status === 'expired' || (expiresAt !== null && expiresAt <= now)) return 'expired'
  return 'unavailable'
}

export function getAccountLicenseStatus(license: AccountLicenseSummary, now = Date.now()): AccountLicenseStatus {
  const quotaLimit = Math.max(license.unifiedTokenLimit ?? 0, 0)
  const quotaRemaining = Math.max(quotaLimit - (license.unifiedTokenUsage ?? 0), 0)
  const expansionPackRemaining = getAccountExpansionPackRemaining(license.quotaPacks, now)
  const usable = isAccountLicenseUsable(license.status, license.expiresAt, license.quotaPacks, now, license.platform)
  const expiresAt = licenseExpiryTime(license)
  const daysUntilExpiry =
    usable && ['active', 'inactive', 'refunding'].includes(license.status) && expiresAt !== null && expiresAt > now
      ? Math.ceil((expiresAt - now) / DAY_MS)
      : null
  const expiryDate = expiresAt !== null && Number.isFinite(expiresAt) ? license.expiresAt! : null
  const base = { usable, daysUntilExpiry, expiryDate, quotaRemaining, quotaLimit, expansionPackRemaining }

  if (!usable || license.status === 'disabled' || license.status === 'refunded') {
    return { ...base, kind: getUnusableKind(license, now) }
  }
  if (license.status === 'expired' || (expiresAt !== null && expiresAt <= now)) return { ...base, kind: 'expired' }
  if (license.status === 'refunding') return { ...base, kind: 'refunding' }
  if (quotaLimit > 0 && quotaRemaining <= 0 && expansionPackRemaining <= 0) return { ...base, kind: 'quota_exhausted' }
  if (daysUntilExpiry !== null && daysUntilExpiry <= EXPIRING_SOON_DAYS) return { ...base, kind: 'expiring_soon' }
  return { ...base, kind: 'valid' }
}

/** Orders licenses so the ones worth using come first; ties keep the later expiry first, then the API order. */
export function sortAccountLicensesByStatus<T extends AccountLicenseSummary>(
  licenses: readonly T[],
  now = Date.now()
): T[] {
  const expiryTime = (license: AccountLicenseSummary) => {
    const time = licenseExpiryTime(license)
    if (time === null) return Number.POSITIVE_INFINITY
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time
  }
  return licenses
    .map((license, index) => ({ license, index, status: getAccountLicenseStatus(license, now) }))
    .sort(
      (a, b) =>
        Number(b.status.usable) - Number(a.status.usable) ||
        STATUS_ORDER[a.status.kind] - STATUS_ORDER[b.status.kind] ||
        expiryTime(b.license) - expiryTime(a.license) ||
        a.index - b.index
    )
    .map(({ license }) => license)
}

export function selectAccountLicense<T extends AccountLicenseSummary>(
  licenses: readonly T[],
  settings: Pick<Settings, 'licenseKey' | 'licenseActivationMethod' | 'licenseInstances' | 'lastSelectedLicenseByUser'>,
  email: string,
  afterLogin = false,
  now = Date.now()
) {
  const eligible = sortAccountLicensesByStatus(licenses, now).filter(
    (license) => getAccountLicenseStatus(license, now).usable
  )
  const current = eligible.find((license) => license.key === settings.licenseKey)
  const preferred = current ?? eligible.find((license) => license.key === settings.lastSelectedLicenseByUser?.[email])
  const selected = preferred ?? eligible[0]
  const preserveManual = Boolean(!afterLogin && settings.licenseActivationMethod === 'manual' && settings.licenseKey)
  return {
    eligible,
    preferred,
    selected,
    preserveManual,
    needsActivation: Boolean(
      !preserveManual &&
        selected &&
        (selected.key !== settings.licenseKey ||
          settings.licenseActivationMethod !== 'login' ||
          !settings.licenseInstances?.[selected.key])
    ),
  }
}

/** All hosts allow inspection when every license is unavailable. */
export function isAccountLicenseOptionDisabled(
  license: AccountLicenseSummary,
  licenses: readonly AccountLicenseSummary[],
  now = Date.now()
): boolean {
  return (
    licenses.some((item) => getAccountLicenseStatus(item, now).usable) && !getAccountLicenseStatus(license, now).usable
  )
}

/** Choose an account-owned key for read-only details, independently of activation. */
export function selectAccountLicenseForInspection<T extends AccountLicenseSummary>(
  licenses: readonly T[],
  preferredKeys: readonly (string | null | undefined)[]
): T | undefined {
  for (const key of preferredKeys) {
    const license = licenses.find((candidate) => candidate.key === key)
    if (license) return license
  }
  return sortAccountLicensesByStatus(licenses)[0]
}
