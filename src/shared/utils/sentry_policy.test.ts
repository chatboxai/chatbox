import { describe, expect, test, vi } from 'vitest'
import { createSentryEventProcessor, normalizeErrorForSentry } from './sentry_policy'

function createProcessor(overrides: Partial<Parameters<typeof createSentryEventProcessor>[0]> = {}) {
  return createSentryEventProcessor({
    normalSampleRate: 0.1,
    random: () => 0,
    source: 'renderer',
    ...overrides,
  })
}

describe('Sentry event policy', () => {
  test('classifies error-boundary failures as critical UI errors', () => {
    const event = {
      tags: { errorBoundary: 'message-item' },
      exception: { values: [{ type: 'TypeError', value: 'boom', mechanism: { handled: true } }] },
    }

    expect(createProcessor()(event)).toBe(event)
    expect(event.tags).toMatchObject({
      error_domain: 'ui',
      error_handled: 'true',
      error_operation: 'message-item',
      error_priority: 'critical',
      error_sample_rate: '1',
      error_source: 'renderer',
    })
  })

  test('keeps high-priority initialization errors without normal sampling', () => {
    const random = vi.fn(() => 0.99)
    const event = {
      tags: { component: 'knowledge-base-db', operation: 'database_initialization' },
      exception: { values: [{ value: 'Database not initialized' }] },
    }

    expect(createProcessor({ random, source: 'main' })(event)).toBe(event)
    expect(random).not.toHaveBeenCalled()
    expect(event.tags).toMatchObject({
      error_domain: 'knowledge-base',
      error_operation: 'database_initialization',
      error_priority: 'high',
      error_source: 'main',
    })
  })

  test('keeps transaction rollback failures without normal sampling', () => {
    const random = vi.fn(() => 0.99)
    const event = {
      tags: { component: 'knowledge-base-db', operation: 'transaction_rollback' },
      exception: { values: [{ value: 'rollback failed' }] },
    }

    expect(createProcessor({ random, source: 'main' })(event)).toBe(event)
    expect(random).not.toHaveBeenCalled()
    expect(event.tags).toMatchObject({
      error_operation: 'transaction_rollback',
      error_priority: 'high',
      error_sample_rate: '1',
    })
  })

  test('samples normal handled failures', () => {
    const event = { tags: { component: 'clipboard', operation: 'copy' }, message: 'copy failed' }

    expect(createProcessor({ random: () => 0.5 })(event)).toBeNull()
  })

  test('drops known browser noise', () => {
    const event = { exception: { values: [{ value: 'ResizeObserver loop limit exceeded' }] } }

    expect(createProcessor()(event)).toBeNull()
  })

  test('deduplicates the same original exception when enabled', () => {
    const error = new Error('duplicate')
    const processor = createProcessor({ dedupeOriginalExceptions: true, source: 'main' })

    expect(processor({ message: error.message }, { originalException: error })).not.toBeNull()
    expect(processor({ message: error.message }, { originalException: error })).toBeNull()
  })

  test('redacts explicit private fields and credentials while preserving diagnostic fields', () => {
    const event = {
      exception: { values: [{ value: 'failed at /Users/alice/data with Bearer abc123' }] },
      extra: {
        accessToken: 'secret',
        anthropicApiKey: 'secret',
        apiKey: 123456,
        apiKeyHash: 'safe-hash',
        clientSecret: 'secret',
        content: 'private content',
        contentHash: 'safe-hash',
        contentLength: 2048,
        contentPreview: 'private content',
        contentType: 'application/json',
        completionTokens: 64,
        credentialStatus: 'configured',
        dbPath: '/Users/alice/private.sqlite',
        fileCount: 2,
        maxTokens: 4096,
        messagesCount: 3,
        password: 'secret',
        promptVersion: 'v2',
        promptTokens: 64,
        query: 'private query',
        queryDurationMs: 23,
        queryPlan: 'hybrid',
        queryStatus: 'completed',
        querySummary: 'private text',
        storageKey: 'blob-reference',
        token: 'secret',
        tokenCount: 128,
        tokenCountMap: { default: 128 },
        tokenEstimate: 'approximate',
      },
      request: {
        data: { prompt: 'private' },
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer secret',
          'api-key': 'azure-secret',
          'anthropic-api-key': 'anthropic-secret',
          'x-auth-token': 'auth-secret',
          'x-goog-api-key': 'google-secret',
          'X-Request-Id': 'request-123',
        },
        url: 'https://example.com/path?token=secret#section',
      },
      user: { email: 'alice@example.com' },
    }

    expect(createProcessor()(event)).toBe(event)
    expect(event.extra).toEqual({
      accessToken: '[redacted]',
      anthropicApiKey: '[redacted]',
      apiKey: '[redacted]',
      apiKeyHash: 'safe-hash',
      clientSecret: '[redacted]',
      content: '[redacted]',
      contentHash: 'safe-hash',
      contentLength: 2048,
      contentPreview: '[redacted]',
      contentType: 'application/json',
      completionTokens: 64,
      credentialStatus: 'configured',
      dbPath: '[redacted]',
      fileCount: 2,
      maxTokens: 4096,
      messagesCount: 3,
      password: '[redacted]',
      promptVersion: 'v2',
      promptTokens: 64,
      query: '[redacted]',
      queryDurationMs: 23,
      queryPlan: 'hybrid',
      queryStatus: 'completed',
      querySummary: '[redacted]',
      storageKey: 'blob-reference',
      token: '[redacted]',
      tokenCount: 128,
      tokenCountMap: { default: 128 },
      tokenEstimate: 'approximate',
    })
    expect(event.request).toEqual({
      data: undefined,
      headers: { Accept: 'application/json', 'X-Request-Id': 'request-123' },
      url: 'https://example.com/path',
    })
    expect(event.exception.values[0].value).toBe('failed at /Users/[redacted]/data with Bearer [redacted]')
    expect(event.user).toBeUndefined()
  })

  test('redacts nested context, stack paths, and navigation URLs', () => {
    const event = {
      breadcrumbs: [
        {
          category: 'navigation',
          data: {
            from: 'https://app.local/chat?token=secret',
            nested: { prompt: 'private text' },
            to: 'https://app.local/session/id#details',
          },
          message: 'opened /home/alice/private',
        },
      ],
      contexts: { app: { apiKey: 'secret', installPath: '/home/alice/chatbox' } },
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                { filename: 'C:\\Users\\Alice\\AppData\\Local\\Chatbox\\main.js' },
                { abs_path: '/home/alice/chatbox/main.js' },
              ],
            },
            value: 'failed in /home/alice/chatbox',
          },
        ],
      },
      extra: { details: { filePath: '/home/alice/private.txt' } },
    }

    expect(createProcessor()(event)).toBe(event)
    expect(event.contexts).toEqual({ app: { apiKey: '[redacted]', installPath: '/home/[redacted]/chatbox' } })
    expect(event.extra).toEqual({ details: { filePath: '[redacted]' } })
    expect(event.exception.values[0].value).toBe('failed in /home/[redacted]/chatbox')
    expect(event.exception.values[0].stacktrace.frames).toEqual([
      { filename: 'C:\\Users\\[redacted]\\AppData\\Local\\Chatbox\\main.js' },
      { abs_path: '/home/[redacted]/chatbox/main.js' },
    ])
    expect(event.breadcrumbs[0]).toEqual({
      category: 'navigation',
      data: {
        from: 'https://app.local/chat',
        nested: { prompt: '[redacted]' },
        to: 'https://app.local/session/id',
      },
      message: 'opened /home/[redacted]/private',
    })
  })

  test('normalizes non-string Sentry text fields without throwing or leaking their objects', () => {
    const event = {
      message: { requestBody: 'private prompt', apiKey: 'sk-private-secret' },
      exception: {
        values: [
          {
            type: 'ProviderError',
            value: { message: 'private provider response', token: 'secret' },
            stacktrace: { frames: [{ filename: { path: '/Users/alice/private' } }] },
          },
        ],
      },
      tags: { error_priority: 'high' },
    }

    expect(() => createProcessor()(event)).not.toThrow()
    expect(event.message).toBe('[non-string object]')
    expect(event.exception.values[0].value).toBe('[non-string object]')
    expect(event.exception.values[0].stacktrace.frames[0].filename).toBe('[non-string object]')
    expect(JSON.stringify(event)).not.toMatch(/private prompt|private provider response|sk-private-secret/)
  })

  test('drops malformed events when privacy sanitization itself cannot safely inspect them', () => {
    const event = { exception: { values: [{ value: 'boom' }] } }
    Object.defineProperty(event, 'extra', {
      get() {
        throw new Error('getter failed')
      },
    })

    expect(createProcessor()(event)).toBeNull()
  })
})

describe('normalizeErrorForSentry', () => {
  test('keeps real Error instances intact', () => {
    const error = new Error('boom')
    expect(normalizeErrorForSentry(error)).toBe(error)
  })

  test('keeps only allowlisted machine descriptors from provider objects', () => {
    const normalized = normalizeErrorForSentry({
      type: 'server_error',
      code: 'server_shutdown',
      statusCode: 503,
      message: 'private provider response containing a user prompt',
      apiKey: 'sk-private-secret',
      requestBody: { prompt: 'private prompt' },
    })

    expect(normalized).toBeInstanceOf(Error)
    expect(normalized.name).toBe('NonErrorException')
    expect(normalized.message).toBe(
      'Non-Error exception (object; type=server_error; code=server_shutdown; status_code=503)'
    )
    expect(normalized.message).not.toMatch(/private|prompt|secret|\[object Object\]/)
  })

  test('does not inspect the content of primitive throws', () => {
    expect(normalizeErrorForSentry('private user text').message).toBe('Non-Error exception (string)')
  })

  test('preserves finite primitive numbers as safe diagnostics', () => {
    expect(normalizeErrorForSentry(401).message).toBe('Non-Error exception (number; value=401)')
    expect(normalizeErrorForSentry(429).message).toBe('Non-Error exception (number; value=429)')
    expect(normalizeErrorForSentry(500).message).toBe('Non-Error exception (number; value=500)')
  })

  test('does not preserve non-finite primitive numbers', () => {
    expect(normalizeErrorForSentry(Number.NaN).message).toBe('Non-Error exception (number)')
    expect(normalizeErrorForSentry(Number.POSITIVE_INFINITY).message).toBe('Non-Error exception (number)')
    expect(normalizeErrorForSentry(Number.NEGATIVE_INFINITY).message).toBe('Non-Error exception (number)')
  })
})
