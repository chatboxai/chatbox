import { beforeEach, describe, expect, test, vi } from 'vitest'
import { reportError } from './sentry'

const { captureException, setExtra, setTag } = vi.hoisted(() => ({
  captureException: vi.fn(),
  setExtra: vi.fn(),
  setTag: vi.fn(),
}))

vi.mock('@sentry/react', () => ({
  captureException,
  withScope: (callback: (scope: { setExtra: typeof setExtra; setTag: typeof setTag }) => void) =>
    callback({ setExtra, setTag }),
}))

describe('reportError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('adds stable classification and bounded context', () => {
    const error = new Error('boom')

    reportError(error, {
      domain: 'session',
      extras: { retryCount: 2 },
      handled: false,
      operation: 'generation',
      priority: 'high',
      tags: { provider: 'openai' },
    })

    expect(captureException).toHaveBeenCalledWith(error)
    expect(setTag).toHaveBeenCalledWith('error_domain', 'session')
    expect(setTag).toHaveBeenCalledWith('error_operation', 'generation')
    expect(setTag).toHaveBeenCalledWith('error_priority', 'high')
    expect(setTag).toHaveBeenCalledWith('error_handled', 'false')
    expect(setTag).toHaveBeenCalledWith('provider', 'openai')
    expect(setExtra).toHaveBeenCalledWith('retryCount', 2)
  })

  test('normalizes non-Error values', () => {
    reportError('failed', { domain: 'application', operation: 'startup' })

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'NonErrorException', message: 'Non-Error exception (string)' })
    )
  })

  test('does not forward fields from provider error objects', () => {
    reportError(
      {
        type: 'server_error',
        code: 'server_shutdown',
        message: 'private provider response',
        apiKey: 'sk-private-secret',
      },
      { domain: 'ai-generation', operation: 'send_message' }
    )

    const captured = captureException.mock.calls[0][0]
    expect(captured).toBeInstanceOf(Error)
    expect(captured.message).toBe('Non-Error exception (object; type=server_error; code=server_shutdown)')
    expect(captured.message).not.toMatch(/private|secret|\[object Object\]/)
  })
})
