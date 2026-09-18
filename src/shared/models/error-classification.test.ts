import { describe, expect, it } from 'vitest'
import { isExpectedGenerationError, isProviderErrorPayload } from './error-classification'
import {
  AIProviderNoImplementedPaintError,
  ApiError,
  BaseError,
  ChatboxAIAPIError,
  ModelProviderNotFoundError,
  NetworkError,
  OCRError,
} from './errors'

describe('isExpectedGenerationError', () => {
  it('recognizes provider and user-facing failures', () => {
    expect(isExpectedGenerationError(new ApiError('rate limited'))).toBe(true)
    expect(isExpectedGenerationError(new NetworkError('offline', 'https://example.com'))).toBe(true)
    expect(isExpectedGenerationError(ChatboxAIAPIError.fromCodeName('quota', 'token_quota_exhausted'))).toBe(true)
    expect(isExpectedGenerationError(new AIProviderNoImplementedPaintError('openai'))).toBe(true)
    expect(isExpectedGenerationError(new OCRError('builtin', new BaseError('bad image')))).toBe(true)
    expect(isExpectedGenerationError(new ModelProviderNotFoundError('custom-provider-1'))).toBe(true)
  })

  it('recognizes plain provider error payloads', () => {
    expect(isExpectedGenerationError({ type: 'upstream_error', message: 'upstream failed' })).toBe(true)
    expect(isExpectedGenerationError({ code: 429, message: 'rate limited' })).toBe(true)
    expect(isExpectedGenerationError({ type: 'server_error', code: 'bad_gateway', message: 'bad gateway' })).toBe(true)
    expect(
      isExpectedGenerationError({ type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } })
    ).toBe(true)
  })

  it('keeps shapeless objects reportable', () => {
    expect(isProviderErrorPayload({ message: 'no discriminator' })).toBe(false)
    expect(isProviderErrorPayload({ type: 'upstream_error' })).toBe(false)
    expect(isProviderErrorPayload(Object.assign(new Error('boom'), { code: 'x' }))).toBe(false)
    expect(isProviderErrorPayload(null)).toBe(false)
  })

  it('keeps unexpected runtime failures reportable', () => {
    expect(isExpectedGenerationError(new Error('boom'))).toBe(false)
    expect(isExpectedGenerationError(new OCRError('builtin', new Error('bad image')))).toBe(false)
    expect(isExpectedGenerationError('string error')).toBe(false)
  })
})
