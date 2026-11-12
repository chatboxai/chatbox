import {
  accountLicenseFromApi,
  getAccountLicenseStatus as sharedLicenseStatus,
  sortAccountLicensesByStatus as sharedLicenseSort,
} from '@shared/utils/account-license'
import type { UserLicense } from '@/packages/remote'

export type { AccountLicenseStatus, AccountLicenseStatusKind } from '@shared/utils/account-license'
export { EXPIRING_SOON_DAYS } from '@shared/utils/account-license'

export function getAccountLicenseStatus(license: UserLicense, now = Date.now()) {
  return sharedLicenseStatus(accountLicenseFromApi(license), now)
}

export function sortAccountLicensesByStatus(licenses: UserLicense[], now = Date.now()): UserLicense[] {
  return sharedLicenseSort(
    licenses.map((source) => ({ ...accountLicenseFromApi(source), source })),
    now
  ).map(({ source }) => source)
}

export function maskLicenseKey(key: string): string {
  return `${key.substring(0, 8)}••••${key.length > 12 ? key.substring(key.length - 4) : ''}`
}
