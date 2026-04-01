import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkOverflow,
  DEFAULT_COMPACTION_THRESHOLD,
  getCompactionThresholdTokens,
  isOverflow,
  OUTPUT_RESERVE_TOKENS,
} from './compaction-detector'

vi.mock('../model-registry', () => ({
  getModelContextWindowSync: vi.fn((modelId: string) => {
    const contextWindows: Record<string, number> = {
      'gpt-4o': 128_000,
      'gpt-4o-mini': 128_000,
      'claude-3-5-sonnet-20241022': 200_000,
      'claude-3-haiku-20240307': 200_000,
      'gemini-1.5-pro': 1_000_000,
      'deepseek-chat': 64_000,
      'small-model': 40_000,
    }
    return contextWindows[modelId] ?? null
  }),
}))

describe('compaction-detector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checkOverflow', () => {
    describe('edge cases', () => {
      it('returns no overflow for zero tokens', () => {
        const result = checkOverflow({ tokens: 0, modelId: 'gpt-4o' })
        expect(result.isOverflow).toBe(false)
        expect(result.contextWindow).toBeNull()
        expect(result.thresholdTokens).toBeNull()
        expect(result.currentTokens).toBe(0)
      })

      it('returns no overflow for negative tokens', () => {
        const result = checkOverflow({ tokens: -100, modelId: 'gpt-4o' })
        expect(result.isOverflow).toBe(false)
        expect(result.currentTokens).toBe(-100)
      })

      it('returns no overflow for unknown model', () => {
        const result = checkOverflow({ tokens: 50_000, modelId: 'unknown-model-xyz' })
        expect(result.isOverflow).toBe(false)
        expect(result.contextWindow).toBeNull()
        expect(result.thresholdTokens).toBeNull()
      })

      it('handles small context models with available window fallback', () => {
        const result = checkOverflow({ tokens: 1000, modelId: 'small-model' })
        const contextWindow = 40_000
        const availableWindow = Math.max(contextWindow - OUTPUT_RESERVE_TOKENS, Math.floor(contextWindow * 0.5))
        expect(result.isOverflow).toBe(false)
        expect(result.contextWindow).toBe(40_000)
        expect(result.thresholdTokens).toBe(Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD))
      })
    })

    describe('threshold calculation with default settings', () => {
      it('calculates threshold correctly for gpt-4o', () => {
        const contextWindow = 128_000
        const availableWindow = contextWindow - OUTPUT_RESERVE_TOKENS
        const expectedThreshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

        const result = checkOverflow({ tokens: 10_000, modelId: 'gpt-4o' })

        expect(result.contextWindow).toBe(contextWindow)
        expect(result.thresholdTokens).toBe(expectedThreshold)
        expect(result.currentTokens).toBe(10_000)
      })

      it('detects overflow when tokens exceed threshold', () => {
        const contextWindow = 128_000
        const availableWindow = contextWindow - OUTPUT_RESERVE_TOKENS
        const threshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

        const result = checkOverflow({ tokens: threshold + 1, modelId: 'gpt-4o' })
        expect(result.isOverflow).toBe(true)
      })

      it('detects no overflow when tokens equal threshold', () => {
        const contextWindow = 128_000
        const availableWindow = contextWindow - OUTPUT_RESERVE_TOKENS
        const threshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

        const result = checkOverflow({ tokens: threshold, modelId: 'gpt-4o' })
        expect(result.isOverflow).toBe(false)
      })

      it('detects no overflow when tokens below threshold', () => {
        const contextWindow = 128_000
        const availableWindow = contextWindow - OUTPUT_RESERVE_TOKENS
        const threshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

        const result = checkOverflow({ tokens: threshold - 1, modelId: 'gpt-4o' })
        expect(result.isOverflow).toBe(false)
      })
    })

    describe('threshold calculation with custom settings', () => {
      it('uses custom compactionThreshold from settings', () => {
        const contextWindow = 128_000
        const availableWindow = contextWindow - OUTPUT_RESERVE_TOKENS
        const customThreshold = 0.8
        const expectedThresholdTokens = Math.floor(availableWindow * customThreshold)

        const result = checkOverflow({
          tokens: 10_000,
          modelId: 'gpt-4o',
          settings: { compactionThreshold: customThreshold },
        })

        expect(result.thresholdTokens).toBe(expectedThresholdTokens)
      })

      it('lower threshold triggers overflow earlier', () => {
        const contextWindow = 128_000
        const availableWindow = contextWindow - OUTPUT_RESERVE_TOKENS
        const lowThreshold = 0.4
        const thresholdTokens = Math.floor(availableWindow * lowThreshold)

        const result = checkOverflow({
          tokens: thresholdTokens + 1,
          modelId: 'gpt-4o',
          settings: { compactionThreshold: lowThreshold },
        })

        expect(result.isOverflow).toBe(true)
      })

      it('higher threshold allows more tokens before overflow', () => {
        const contextWindow = 128_000
        const availableWindow = contextWindow - OUTPUT_RESERVE_TOKENS
        const defaultThresholdTokens = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)
        const highThreshold = 0.9
        const highThresholdTokens = Math.floor(availableWindow * highThreshold)

        const tokensAboveDefault = defaultThresholdTokens + 5000

        const resultDefault = checkOverflow({
          tokens: tokensAboveDefault,
          modelId: 'gpt-4o',
        })
        const resultHigh = checkOverflow({
          tokens: tokensAboveDefault,
          modelId: 'gpt-4o',
          settings: { compactionThreshold: highThreshold },
        })

        expect(resultDefault.isOverflow).toBe(true)
        expect(resultHigh.isOverflow).toBe(false)
        expect(highThresholdTokens).toBeGreaterThan(defaultThresholdTokens)
      })
    })

    describe('different models', () => {
      it('handles Claude models with 200k context', () => {
        const contextWindow = 200_000
        const availableWindow = contextWindow - OUTPUT_RESERVE_TOKENS
        const expectedThreshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

        const result = checkOverflow({ tokens: 50_000, modelId: 'claude-3-5-sonnet-20241022' })

        expect(result.contextWindow).toBe(contextWindow)
        expect(result.thresholdTokens).toBe(expectedThreshold)
        expect(result.isOverflow).toBe(false)
      })

      it('handles Gemini models with 1M context', () => {
        const contextWindow = 1_000_000
        const availableWindow = contextWindow - OUTPUT_RESERVE_TOKENS
        const expectedThreshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

        const result = checkOverflow({ tokens: 100_000, modelId: 'gemini-1.5-pro' })

        expect(result.contextWindow).toBe(contextWindow)
        expect(result.thresholdTokens).toBe(expectedThreshold)
        expect(result.isOverflow).toBe(false)
      })

      it('handles DeepSeek with 64k context', () => {
        const result = checkOverflow({ tokens: 10_000, modelId: 'deepseek-chat' })

        expect(result.contextWindow).toBe(64_000)
        expect(result.isOverflow).toBe(false)
      })
    })

    describe('provided contextWindow override', () => {
      it('uses provided contextWindow over builtin-data when specified', () => {
        const providedContextWindow = 64_000
        const availableWindow = providedContextWindow - OUTPUT_RESERVE_TOKENS
        const expectedThreshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

        const result = checkOverflow({
          tokens: 25_000,
          modelId: 'gpt-4o',
          contextWindow: providedContextWindow,
        })

        expect(result.contextWindow).toBe(providedContextWindow)
        expect(result.thresholdTokens).toBe(expectedThreshold)
      })

      it('detects overflow with smaller provided contextWindow even when builtin is larger', () => {
        const providedContextWindow = 64_000
        const availableWindow = providedContextWindow - OUTPUT_RESERVE_TOKENS
        const threshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

        const result = checkOverflow({
          tokens: threshold + 1,
          modelId: 'gpt-4o',
          contextWindow: providedContextWindow,
        })

        expect(result.isOverflow).toBe(true)
        expect(result.contextWindow).toBe(providedContextWindow)
      })

      it('falls back to builtin-data when contextWindow is not provided', () => {
        const result = checkOverflow({
          tokens: 10_000,
          modelId: 'gpt-4o',
        })

        expect(result.contextWindow).toBe(128_000)
      })

      it('works with unknown model when contextWindow is provided', () => {
        const providedContextWindow = 50_000
        const availableWindow = Math.max(
          providedContextWindow - OUTPUT_RESERVE_TOKENS,
          Math.floor(providedContextWindow * 0.5)
        )
        const expectedThreshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

        const result = checkOverflow({
          tokens: 10_000,
          modelId: 'unknown-model-xyz',
          contextWindow: providedContextWindow,
        })

        expect(result.isOverflow).toBe(false)
        expect(result.contextWindow).toBe(providedContextWindow)
        expect(result.thresholdTokens).toBe(expectedThreshold)
      })
    })
  })

  describe('isOverflow', () => {
    it('returns boolean true for overflow', () => {
      const contextWindow = 128_000
      const availableWindow = contextWindow - OUTPUT_RESERVE_TOKENS
      const threshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

      const result = isOverflow({ tokens: threshold + 1, modelId: 'gpt-4o' })
      expect(result).toBe(true)
    })

    it('returns boolean false for no overflow', () => {
      const result = isOverflow({ tokens: 10_000, modelId: 'gpt-4o' })
      expect(result).toBe(false)
    })

    it('returns false for unknown model', () => {
      const result = isOverflow({ tokens: 999_999, modelId: 'unknown-xyz' })
      expect(result).toBe(false)
    })
  })

  describe('getCompactionThresholdTokens', () => {
    it('returns threshold tokens for known model', () => {
      const contextWindow = 128_000
      const availableWindow = contextWindow - OUTPUT_RESERVE_TOKENS
      const expectedThreshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

      const result = getCompactionThresholdTokens('gpt-4o')
      expect(result).toBe(expectedThreshold)
    })

    it('returns null for unknown model', () => {
      const result = getCompactionThresholdTokens('unknown-model')
      expect(result).toBeNull()
    })

    it('uses custom threshold from settings', () => {
      const contextWindow = 128_000
      const availableWindow = contextWindow - OUTPUT_RESERVE_TOKENS
      const customThreshold = 0.5
      const expectedThreshold = Math.floor(availableWindow * customThreshold)

      const result = getCompactionThresholdTokens('gpt-4o', { compactionThreshold: customThreshold })
      expect(result).toBe(expectedThreshold)
    })

    it('handles model with small context window', () => {
      const contextWindow = 40_000
      const availableWindow = Math.max(contextWindow - OUTPUT_RESERVE_TOKENS, Math.floor(contextWindow * 0.5))

      const result = getCompactionThresholdTokens('small-model')

      expect(result).toBe(Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD))
    })

    it('uses provided contextWindow when specified', () => {
      const providedContextWindow = 64_000
      const availableWindow = providedContextWindow - OUTPUT_RESERVE_TOKENS
      const expectedThreshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

      const result = getCompactionThresholdTokens('gpt-4o', undefined, providedContextWindow)
      expect(result).toBe(expectedThreshold)
    })

    it('returns threshold for unknown model when contextWindow is provided', () => {
      const providedContextWindow = 50_000
      const availableWindow = Math.max(
        providedContextWindow - OUTPUT_RESERVE_TOKENS,
        Math.floor(providedContextWindow * 0.5)
      )
      const expectedThreshold = Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD)

      const result = getCompactionThresholdTokens('unknown-model', undefined, providedContextWindow)
      expect(result).toBe(expectedThreshold)
    })
  })

  describe('constants', () => {
    it('exports OUTPUT_RESERVE_TOKENS as 32000', () => {
      expect(OUTPUT_RESERVE_TOKENS).toBe(32_000)
    })

    it('exports DEFAULT_COMPACTION_THRESHOLD as 0.6', () => {
      expect(DEFAULT_COMPACTION_THRESHOLD).toBe(0.6)
    })
  })
})
