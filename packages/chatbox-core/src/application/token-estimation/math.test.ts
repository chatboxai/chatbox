import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMPACTION_THRESHOLD,
  estimateTokensBySampling,
  getCompactionBudget,
  getOutputReserveTokens,
  getRetainedTailTokens,
  OUTPUT_RESERVE_TOKENS,
  shouldCompactAtTokens,
} from './math'

describe('compaction budget', () => {
  it('reserves the reply limit, capped at a quarter of the window and 32K', () => {
    expect(getOutputReserveTokens(16_384, 2_048)).toBe(2_048)
    expect(getOutputReserveTokens(16_384, 8_192)).toBe(4_096)
    expect(getOutputReserveTokens(16_384, undefined)).toBe(4_096)
    expect(getOutputReserveTokens(200_000, 128_000)).toBe(OUTPUT_RESERVE_TOKENS)
    expect(getOutputReserveTokens(128_000, 16_384)).toBe(16_384)
  })

  it.each([
    // window, max output, threshold, usable, compaction threshold, compaction target
    [8_192, undefined, undefined, 6_144, 4_608, 3_072],
    [16_384, undefined, undefined, 12_288, 9_216, 6_144],
    [16_384, 2_048, undefined, 14_336, 10_752, 7_168],
    [32_768, undefined, undefined, 24_576, 18_432, 12_288],
    [131_072, undefined, undefined, 99_072, 74_304, 49_536],
    [131_072, 16_384, 0.6, 114_688, 68_812, 45_874],
    [131_072, 16_384, 0.4, 114_688, 45_875, 30_583],
    [131_072, 16_384, 0.9, 114_688, 103_219, 57_344],
    [200_000, 128_000, undefined, 168_000, 126_000, 84_000],
  ])(
    'sizes a %i window with max output %s and threshold %s',
    (window, maxOutput, threshold, usable, trigger, target) => {
      const budget = getCompactionBudget(window, { maxOutputTokens: maxOutput, compactionThreshold: threshold })!
      expect(budget.usableTokens).toBe(usable)
      expect(budget.thresholdTokens).toBe(trigger)
      expect(budget.targetTokens).toBe(target)
      expect(budget.targetTokens).toBeLessThan(budget.thresholdTokens)
      expect(budget.minGrowthTokens).toBe(Math.floor(usable * 0.15))
      expect(budget.summaryAllowanceTokens).toBe(Math.min(4_096, Math.floor(usable * 0.1)))
    }
  )

  it('uses the default threshold and rejects an unusable window', () => {
    expect(DEFAULT_COMPACTION_THRESHOLD).toBe(0.75)
    expect(getCompactionBudget(0)).toBeNull()
    expect(getCompactionBudget(Number.NaN)).toBeNull()
  })

  it('compacts above the threshold and then waits for meaningful growth', () => {
    const budget = getCompactionBudget(16_384)!
    expect(shouldCompactAtTokens(budget, budget.thresholdTokens)).toBe(false)
    expect(shouldCompactAtTokens(budget, budget.thresholdTokens + 1)).toBe(true)

    const compacted = budget.thresholdTokens + 200
    expect(shouldCompactAtTokens(budget, compacted + budget.minGrowthTokens - 1, compacted)).toBe(false)
    expect(shouldCompactAtTokens(budget, compacted + budget.minGrowthTokens, compacted)).toBe(true)
    // A request that no longer fits the usable window always compacts.
    expect(shouldCompactAtTokens(budget, budget.usableTokens + 1, budget.usableTokens)).toBe(true)
  })

  it('sizes the retained tail from the target after fixed content and the summary', () => {
    const budget = getCompactionBudget(16_384)!
    expect(getRetainedTailTokens(budget, 2_000)).toBe(6_144 - 2_000 - 1_228)
    expect(getRetainedTailTokens(budget, 10_000)).toBe(1)
  })
})

describe('estimateTokensBySampling', () => {
  it('weighs CJK near one token per character and latin text near four characters per token', () => {
    expect(estimateTokensBySampling('', 'default')).toBe(0)
    expect(estimateTokensBySampling('保留编号的前导零'.repeat(500), 'default')).toBeGreaterThan(3_500)
    expect(estimateTokensBySampling('hello world '.repeat(500), 'default')).toBe(1_500)
  })
})
