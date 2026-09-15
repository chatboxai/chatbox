import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { APICallError, RetryError } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, MidStreamApiError, NetworkError, NonReplayableRequestError } from './errors'
import { createRetryableChatModel } from './retryable-chat-model'

const request = { prompt: [] }
function apiError(statusCode = 503, retryAfter?: string) {
  return new APICallError({
    message: 'Unavailable',
    url: 'https://example.test',
    requestBodyValues: {},
    statusCode,
    responseHeaders: retryAfter ? { 'Retry-After': retryAfter } : undefined,
  })
}
function successfulStream() {
  return {
    stream: convertArrayToReadableStream([
      { type: 'text-start' as const, id: 'text' },
      { type: 'text-delta' as const, id: 'text', delta: 'Recovered' },
    ]),
  }
}

describe('chat retries', () => {
  it('never replays an ambiguous native POST failure wrapped by a provider', async () => {
    const cause = new NonReplayableRequestError('Native background request expired')
    const error = new APICallError({
      message: 'Provider failed',
      url: 'https://example.test',
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true,
      cause,
    })
    const doStream = vi.fn().mockRejectedValue(error)
    const model = createRetryableChatModel(new MockLanguageModelV3({ doStream }), vi.fn())
    const result = model.doStream(request)
    await expect(result).rejects.toBe(error)
    expect(doStream).toHaveBeenCalledTimes(1)
  })
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('publishes waiting before the delay, then requesting, and recovers', async () => {
    const doStream = vi.fn().mockRejectedValueOnce(apiError()).mockImplementation(successfulStream)
    const status = vi.fn()
    const model = createRetryableChatModel(new MockLanguageModelV3({ doStream }), status)
    const result = model.doStream(request)
    await vi.advanceTimersByTimeAsync(0)
    expect(status).toHaveBeenLastCalledWith({
      type: 'retrying',
      attempt: 2,
      maxAttempts: 5,
      retryAt: Date.now() + 2000,
      statusCode: 503,
    })
    await vi.advanceTimersByTimeAsync(1999)
    expect(doStream).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(status).toHaveBeenLastCalledWith({ type: 'retrying', attempt: 2, maxAttempts: 5, statusCode: 503 })
    const chunks = []
    const reader = (await result).stream.getReader()
    while (true) {
      const next = await reader.read()
      if (next.done) break
      chunks.push(next.value.type)
    }
    expect(chunks).toEqual(['text-start', 'text-delta'])
    expect(doStream).toHaveBeenCalledTimes(2)
  })

  it('stops after five attempts and keeps the final provider error', async () => {
    const error = apiError()
    const doStream = vi.fn().mockRejectedValue(error)
    const status = vi.fn()
    const result = createRetryableChatModel(new MockLanguageModelV3({ doStream }), status).doStream(request)
    const failed = expect(result).rejects.toSatisfy((e: unknown) => RetryError.isInstance(e) && e.lastError === error)
    await vi.advanceTimersByTimeAsync(30000)
    await failed
    expect(doStream).toHaveBeenCalledTimes(5)
    expect(status).toHaveBeenCalledTimes(8)
    expect(status.mock.calls.map(([s]) => s.attempt)).toEqual([2, 2, 3, 3, 4, 4, 5, 5])
  })

  it.each(['10', 'Mon, 14 Sep 2026 00:00:10 GMT'])('honors Retry-After %s', async (header) => {
    const doStream = vi.fn().mockRejectedValueOnce(apiError(429, header)).mockImplementation(successfulStream)
    const status = vi.fn()
    const result = createRetryableChatModel(new MockLanguageModelV3({ doStream }), status).doStream(request)
    await vi.advanceTimersByTimeAsync(0)
    expect(status.mock.calls[0][0].retryAt).toBe(Date.now() + 10000)
    await vi.advanceTimersByTimeAsync(9999)
    expect(doStream).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await result
    expect(doStream).toHaveBeenCalledTimes(2)
  })

  it.each(['invalid', '-1', 'Mon, 01 Jan 2001 00:00:00 GMT', '0'])(
    'uses backoff for Retry-After %s',
    async (header) => {
      const doStream = vi.fn().mockRejectedValueOnce(apiError(429, header)).mockImplementation(successfulStream)
      const result = createRetryableChatModel(new MockLanguageModelV3({ doStream }), vi.fn()).doStream(request)
      await vi.advanceTimersByTimeAsync(1999)
      expect(doStream).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await result
      expect(doStream).toHaveBeenCalledTimes(2)
    }
  )

  it('honors Retry-After preserved by the host request adapter', async () => {
    const doStream = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('Rate limited', undefined, 429, undefined, '10'))
      .mockImplementation(successfulStream)
    const status = vi.fn()
    const result = createRetryableChatModel(new MockLanguageModelV3({ doStream }), status).doStream(request)
    await vi.advanceTimersByTimeAsync(0)
    expect(status.mock.calls[0][0].retryAt).toBe(Date.now() + 10000)
    await vi.advanceTimersByTimeAsync(9999)
    expect(doStream).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await result
    expect(doStream).toHaveBeenCalledTimes(2)
  })

  it.each([
    new TypeError('Failed to fetch'),
    new TypeError('fetch failed'),
    new TypeError('Network request failed'),
    new TypeError('Load failed'),
    new NetworkError('Network disconnected', 'https://example.test'),
    Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    new APICallError({
      message: 'fetch failed',
      url: 'https://example.test',
      requestBodyValues: {},
      isRetryable: true,
    }),
  ])('retries a network failure with waiting status and recovers', async (error) => {
    const doStream = vi.fn().mockRejectedValueOnce(error).mockImplementation(successfulStream)
    const status = vi.fn()
    const result = createRetryableChatModel(new MockLanguageModelV3({ doStream }), status).doStream(request)
    await vi.advanceTimersByTimeAsync(0)
    expect(status).toHaveBeenLastCalledWith({
      type: 'retrying',
      attempt: 2,
      maxAttempts: 5,
      retryAt: Date.now() + 2000,
      statusCode: undefined,
    })
    await vi.advanceTimersByTimeAsync(2000)
    await result
    expect(doStream).toHaveBeenCalledTimes(2)
  })

  it('bounds persistent network failures to five requests', async () => {
    const error = new NetworkError('Failed to fetch', 'https://example.test')
    const doStream = vi.fn().mockRejectedValue(error)
    const result = createRetryableChatModel(new MockLanguageModelV3({ doStream }), vi.fn()).doStream(request)
    const failed = expect(result).rejects.toSatisfy((e: unknown) => RetryError.isInstance(e) && e.lastError === error)
    await vi.advanceTimersByTimeAsync(30000)
    await failed
    expect(doStream).toHaveBeenCalledTimes(5)
  })

  it('does not restart a stream after partial output and a network failure', async () => {
    const error = new TypeError('Failed to fetch')
    const doStream = vi.fn(async () => ({
      stream: convertArrayToReadableStream([
        { type: 'text-start' as const, id: 'text' },
        { type: 'text-delta' as const, id: 'text', delta: 'Partial response' },
        { type: 'error' as const, error },
      ]),
    }))
    const status = vi.fn()
    const response = await createRetryableChatModel(new MockLanguageModelV3({ doStream }), status).doStream(request)
    const reader = response.stream.getReader()
    const parts = []
    while (true) {
      const next = await reader.read()
      if (next.done) break
      parts.push(next.value.type)
    }
    expect(parts).toEqual(['text-start', 'text-delta', 'error'])
    expect(doStream).toHaveBeenCalledTimes(1)
    expect(status).not.toHaveBeenCalled()
  })

  it.each<LanguageModelV3StreamPart>([
    { type: 'text-delta', id: 'text', delta: 'Partial' },
    { type: 'reasoning-delta', id: 'reasoning', delta: 'Partial' },
    { type: 'tool-input-start', id: 'tool', toolName: 'search' },
    { type: 'tool-input-delta', id: 'tool', delta: '{' },
    { type: 'tool-call', toolCallId: 'tool', toolName: 'search', input: '{}' },
  ])('does not replay after $type and a rejected stream read', async (part) => {
    const error = new TypeError('Failed to fetch')
    const doStream = vi.fn(async () => {
      let emitted = false
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          pull(controller) {
            if (emitted) controller.error(error)
            else {
              emitted = true
              controller.enqueue(part)
            }
          },
        }),
      }
    })
    const status = vi.fn()
    const response = await createRetryableChatModel(new MockLanguageModelV3({ doStream }), status).doStream(request)
    const reader = response.stream.getReader()
    expect((await reader.read()).value).toEqual(part)
    expect((await reader.read()).value).toEqual({ type: 'error', error })
    expect((await reader.read()).done).toBe(true)
    expect(doStream).toHaveBeenCalledTimes(1)
    expect(status).not.toHaveBeenCalled()
  })

  it('recovers from a rejected stream read before output', async () => {
    const doStream = vi
      .fn()
      .mockResolvedValueOnce({
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.error(new TypeError('Failed to fetch'))
          },
        }),
      })
      .mockImplementation(successfulStream)
    const status = vi.fn()
    const response = await createRetryableChatModel(new MockLanguageModelV3({ doStream }), status).doStream(request)
    const reader = response.stream.getReader()
    const first = reader.read()
    await vi.advanceTimersByTimeAsync(2000)
    expect((await first).value?.type).toBe('text-start')
    expect((await reader.read()).value).toMatchObject({ type: 'text-delta', delta: 'Recovered' })
    expect((await reader.read()).done).toBe(true)
    expect(doStream).toHaveBeenCalledTimes(2)
    expect(status).toHaveBeenCalledTimes(2)
  })

  it.each([apiError(), new NetworkError('Failed to fetch', 'https://example.test')])(
    'aborts during waiting without starting another request',
    async (error) => {
      const doStream = vi.fn().mockRejectedValue(error)
      const controller = new AbortController()
      const result = createRetryableChatModel(new MockLanguageModelV3({ doStream }), vi.fn()).doStream({
        ...request,
        abortSignal: controller.signal,
      })
      const failed = expect(result).rejects.toMatchObject({ name: 'AbortError' })
      await vi.advanceTimersByTimeAsync(100)
      controller.abort()
      await failed
      await vi.advanceTimersByTimeAsync(30000)
      expect(doStream).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    apiError(401),
    apiError(400),
    new TypeError('Cannot read properties of undefined'),
    Object.assign(new Error('Failed to fetch'), { name: 'AbortError' }),
    new MidStreamApiError('Partial', undefined, 503),
    apiError(429, '9999999999'),
  ])('does not retry ineligible failures', async (error) => {
    const doStream = vi.fn().mockRejectedValue(error)
    const status = vi.fn()
    await expect(
      createRetryableChatModel(new MockLanguageModelV3({ doStream }), status).doStream(request)
    ).rejects.toBe(error)
    expect(doStream).toHaveBeenCalledTimes(1)
    expect(status).not.toHaveBeenCalled()
  })
})
