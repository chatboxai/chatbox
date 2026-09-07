import { estimateTokensForTokenizerType } from '@shared/token-estimation/tokenizer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleDraftTokenizationRequest } from '../draft-tokenizer-worker-handler'

vi.mock('@shared/token-estimation/tokenizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/token-estimation/tokenizer')>()
  return { ...actual, estimateTokensForTokenizerType: vi.fn(actual.estimateTokensForTokenizerType) }
})

describe('draft tokenizer worker handler', () => {
  beforeEach(() => {
    vi.mocked(estimateTokensForTokenizerType).mockClear()
  })

  it('uses the exact default tokenizer', () => {
    expect(handleDraftTokenizationRequest({ text: 'Hello world', tokenizerType: 'default' })).toEqual({ tokens: 2 })
  })

  it('uses the DeepSeek tokenizer', () => {
    expect(handleDraftTokenizationRequest({ text: 'Hello world', tokenizerType: 'deepseek' })).toEqual({ tokens: 4 })
  })

  it('rejects a zero result for non-empty input', () => {
    vi.mocked(estimateTokensForTokenizerType).mockReturnValueOnce(0)

    expect(() => handleDraftTokenizationRequest({ text: 'non-empty', tokenizerType: 'default' })).toThrow(
      'Draft tokenizer returned no tokens for non-empty input'
    )
  })

  it('allows a zero result for empty input', () => {
    vi.mocked(estimateTokensForTokenizerType).mockReturnValueOnce(0)

    expect(handleDraftTokenizationRequest({ text: '', tokenizerType: 'default' })).toEqual({ tokens: 0 })
  })

  it('propagates tokenizer exceptions', () => {
    const tokenizerError = new Error('tokenizer failed')
    vi.mocked(estimateTokensForTokenizerType).mockImplementationOnce(() => {
      throw tokenizerError
    })

    expect(() => handleDraftTokenizationRequest({ text: 'non-empty', tokenizerType: 'default' })).toThrow(
      tokenizerError
    )
  })
})
