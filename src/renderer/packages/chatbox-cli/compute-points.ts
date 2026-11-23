import type { ChatboxAILicenseDetail } from '@shared/types/settings'

type ComputePointQuota = Pick<
  ChatboxAILicenseDetail,
  'remaining_quota_unified' | 'unified_token_limit' | 'unified_token_usage'
>

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function getComputePointsRemainingRatio(quota: ComputePointQuota): number {
  if (quota.unified_token_limit > 0) {
    return clampRatio((quota.unified_token_limit - quota.unified_token_usage) / quota.unified_token_limit)
  }
  return clampRatio(quota.remaining_quota_unified)
}

export function getComputePointsRemainingPercentage(quota: ComputePointQuota): number {
  return Number((getComputePointsRemainingRatio(quota) * 100).toFixed(1))
}

export function formatComputePointsRemainingRatio(ratio: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(clampRatio(ratio))
}
