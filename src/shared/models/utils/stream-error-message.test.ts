import { TypeValidationError } from 'ai'
import { describe, expect, it } from 'vitest'
import { extractStreamErrorMessage, extractStreamErrorStatusCode } from './stream-error-message'

describe('extractStreamErrorMessage', () => {
  it('returns string errors as-is', () => {
    expect(extractStreamErrorMessage('boom')).toBe('boom')
  })

  it('returns Error.message', () => {
    expect(extractStreamErrorMessage(new Error('network down'))).toBe('network down')
  })

  it('extracts message from plain provider error objects', () => {
    expect(
      extractStreamErrorMessage({
        message: 'The server was restarted during this response. Please retry to continue.',
        type: 'server_error',
        code: 'server_shutdown',
      })
    ).toBe('The server was restarted during this response. Please retry to continue.')
  })

  it('extracts nested error.message (Anthropic shape)', () => {
    expect(
      extractStreamErrorMessage({
        type: 'error',
        error: { type: 'overloaded_error', message: 'please retry' },
      })
    ).toBe('please retry')
  })

  it('surfaces the upstream message carried by a chunk that failed schema validation', () => {
    const error = new TypeValidationError({
      value: { error: { message: 'opencode/claude-sonnet-4-6: model — [402]: insufficient credits' } },
      cause: new Error('invalid_union'),
    })
    expect(extractStreamErrorMessage(error)).toBe('opencode/claude-sonnet-4-6: model — [402]: insufficient credits')
  })

  it('keeps the validation message when the rejected value has no upstream message', () => {
    const error = new TypeValidationError({ value: { delta: 1 }, cause: new Error('invalid_union') })
    expect(extractStreamErrorMessage(error)).toBe(error.message)
  })

  it('falls back to JSON for objects without message', () => {
    expect(extractStreamErrorMessage({ code: 'x' })).toBe('{"code":"x"}')
  })
})

describe('extractStreamErrorStatusCode', () => {
  it('reads numeric status fields, flat or nested', () => {
    expect(extractStreamErrorStatusCode({ message: 'rate limited', code: 429 })).toBe(429)
    expect(extractStreamErrorStatusCode({ type: 'error', error: { message: 'overloaded', status: 529 } })).toBe(529)
  })

  it('parses a bracketed status from the message of a rejected chunk', () => {
    const error = new TypeValidationError({
      value: { error: { message: 'opencode/claude-sonnet-4-6: model — [402]: insufficient credits' } },
      cause: new Error('invalid_union'),
    })
    expect(extractStreamErrorStatusCode(error)).toBe(402)
  })

  it('ignores non-HTTP codes, unbracketed numbers and Error instances', () => {
    expect(extractStreamErrorStatusCode({ message: 'invalid argument', code: 3 })).toBeUndefined()
    expect(extractStreamErrorStatusCode({ message: 'context of 4096 tokens exceeded, use 500 less' })).toBeUndefined()
    expect(extractStreamErrorStatusCode(new Error('boom'))).toBeUndefined()
    expect(extractStreamErrorStatusCode(null)).toBeUndefined()
  })
})
