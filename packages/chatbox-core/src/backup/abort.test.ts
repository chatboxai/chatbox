import { describe, expect, it } from 'vitest'
import { abortError, isAbortError } from './abort'

describe('backup abort errors', () => {
  it('preserves Error abort reasons', () => {
    const reason = new Error('Canceled by caller')

    expect(abortError(reason)).toBe(reason)
  })

  it('creates an AbortError for non-Error reasons', () => {
    const error = abortError('Canceled by caller')

    expect(error).toMatchObject({
      message: 'Operation canceled',
      name: 'AbortError',
    })
    expect(isAbortError(error)).toBe(true)
  })

  it('recognizes abort errors by name across host boundaries', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true)
    expect(isAbortError(new Error('Failed'))).toBe(false)
  })
})
