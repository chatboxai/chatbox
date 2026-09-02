import type { Message } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  estimateDraftTokensImmediately,
  getDraftTokenizationText,
  getTokenizationTextDigest,
  LONG_DRAFT_TOKENIZATION_THRESHOLD,
  seedExactDraftTokens,
  shouldTokenizeDraftOffMainThread,
} from '../draft-tokenization'
import { estimateDeepSeekTokens, estimateTokensForTokenizerType } from '../tokenizer'

vi.mock('../tokenizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tokenizer')>()
  return { ...actual, estimateTokensForTokenizerType: vi.fn(actual.estimateTokensForTokenizerType) }
})

describe('draft tokenization policy', () => {
  beforeEach(() => {
    vi.mocked(estimateTokensForTokenizerType).mockClear()
  })

  it('keeps short drafts exact on the current thread', () => {
    const text = 'short draft'

    expect(shouldTokenizeDraftOffMainThread(text)).toBe(false)
    vi.mocked(estimateTokensForTokenizerType).mockReturnValueOnce(123)
    expect(estimateDraftTokensImmediately(text, 'default')).toBe(123)
    expect(estimateTokensForTokenizerType).toHaveBeenCalledWith(text, 'default')
  })

  it('does not invoke the tokenizer synchronously for long drafts', () => {
    const text = '长'.repeat(LONG_DRAFT_TOKENIZATION_THRESHOLD)

    expect(shouldTokenizeDraftOffMainThread(text)).toBe(true)
    expect(estimateDraftTokensImmediately(text, 'default')).toBe(LONG_DRAFT_TOKENIZATION_THRESHOLD)
    expect(estimateTokensForTokenizerType).not.toHaveBeenCalled()
  })
})

describe('tokenization text digest', () => {
  it('is deterministic for equal text', () => {
    const text = 'the same projection text'
    expect(getTokenizationTextDigest(text)).toBe(getTokenizationTextDigest(text))
  })

  it('differs when the content changes, even at equal length', () => {
    expect(getTokenizationTextDigest('abcdef')).not.toBe(getTokenizationTextDigest('abcdeg'))
  })

  it('encodes the length so truncations cannot collide silently', () => {
    const digest = getTokenizationTextDigest('hello world')
    expect(digest.startsWith('11:')).toBe(true)
  })
})

describe('long draft sampling', () => {
  it('tracks the DeepSeek whitespace-run rule for indentation-heavy drafts', () => {
    const line = '    const value = compute(index) + 1\n'
    const text = line.repeat(Math.ceil((LONG_DRAFT_TOKENIZATION_THRESHOLD * 2) / line.length))

    const estimate = estimateDraftTokensImmediately(text, 'deepseek')
    const actual = estimateDeepSeekTokens(text)

    expect(estimate).toBeGreaterThan(actual * 0.8)
    expect(estimate).toBeLessThan(actual * 1.2)
  })

  it('classifies astral CJK by full code point', () => {
    const text = '𠀀'.repeat(LONG_DRAFT_TOKENIZATION_THRESHOLD / 2)

    expect(estimateDraftTokensImmediately(text, 'default')).toBe(Math.ceil(1.5 * text.length))
    expect(estimateDraftTokensImmediately(text, 'deepseek')).toBe(Math.ceil(0.3 * text.length))
  })

  it('steps back from trailing surrogates when sampling', () => {
    const text = `a${'𠀀'.repeat(LONG_DRAFT_TOKENIZATION_THRESHOLD / 2)}`

    const estimate = estimateDraftTokensImmediately(text, 'default')

    // Sampled positions land on lead and trailing surrogates alike; stepping
    // back from a trailing one classifies it as astral CJK (~1.5/unit).
    expect(estimate).toBeGreaterThan(1.4 * text.length)
    expect(estimate).toBeLessThanOrEqual(Math.ceil(1.5 * text.length))
  })

  it('does not phase-lock with content whose period divides the stride', () => {
    // Length 4096 with 512 samples gives stride 8 — exactly this pattern's
    // period. Left-edge sampling would put every sample on the whitespace-run
    // start and estimate ~4096 DeepSeek tokens for a ~666-token draft.
    const text = '       a'.repeat(LONG_DRAFT_TOKENIZATION_THRESHOLD / 8)

    const estimate = estimateDraftTokensImmediately(text, 'deepseek')
    const actual = estimateDeepSeekTokens(text)

    expect(estimate).toBeGreaterThan(actual * 0.6)
    expect(estimate).toBeLessThan(actual * 1.6)
  })
})

describe('seeding exact draft tokens onto the outgoing message', () => {
  function draftMessage(text: string): Message {
    return {
      id: 'draft-1',
      role: 'user',
      contentParts: [
        { type: 'text', text },
        { type: 'image', storageKey: 'img-1' },
      ],
    } as Message
  }

  it('writes the count under the tokenizer key when the projection matches', () => {
    const message = draftMessage('long draft text')

    const seeded = seedExactDraftTokens(message, {
      text: getDraftTokenizationText(message),
      tokenizerType: 'deepseek',
      tokens: 4242,
    })

    expect(seeded.tokenCountMap).toEqual({ deepseek: 4242 })
    expect(message.tokenCountMap).toBeUndefined()
  })

  it('keeps existing map entries', () => {
    const message = { ...draftMessage('long draft text'), tokenCountMap: { default: 7 } }

    const seeded = seedExactDraftTokens(message, {
      text: getDraftTokenizationText(message),
      tokenizerType: 'deepseek',
      tokens: 4242,
    })

    expect(seeded.tokenCountMap).toEqual({ default: 7, deepseek: 4242 })
  })

  it('returns the message untouched when the draft drifted or no count exists', () => {
    const message = draftMessage('long draft text')

    expect(seedExactDraftTokens(message, null)).toBe(message)
    expect(seedExactDraftTokens(message, { text: 'a different draft', tokenizerType: 'default', tokens: 4242 })).toBe(
      message
    )
  })
})
