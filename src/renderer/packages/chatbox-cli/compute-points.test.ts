import { describe, expect, it } from 'vitest'
import {
  formatComputePointsRemainingRatio,
  getComputePointsRemainingPercentage,
  getComputePointsRemainingRatio,
} from './compute-points'

describe('compute-point quota formatting', () => {
  const quota = {
    remaining_quota_unified: 0.5,
    unified_token_usage: 106,
    unified_token_limit: 1000,
  }

  it('derives the remaining ratio and percentage from usage and limit', () => {
    expect(getComputePointsRemainingRatio(quota)).toBe(0.894)
    expect(getComputePointsRemainingPercentage(quota)).toBe(89.4)
  })

  it('formats a remaining ratio as a localized percentage', () => {
    expect(formatComputePointsRemainingRatio(0.894, 'zh-Hans')).toBe('89.4%')
  })

  it('preserves the five percent boundary when deriving the remaining ratio', () => {
    expect(
      getComputePointsRemainingRatio({ ...quota, unified_token_limit: 30_000_000, unified_token_usage: 28_500_000 })
    ).toBe(0.05)
  })

  it('clamps fallback ratios to the valid percentage range', () => {
    expect(
      getComputePointsRemainingPercentage({
        remaining_quota_unified: 1.25,
        unified_token_usage: 0,
        unified_token_limit: 0,
      })
    ).toBe(100)
  })
})
