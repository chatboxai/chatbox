import { CapacitorHttp } from '@capacitor/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createNativeResponse } from '@/native/stream-http'
import { handleMobileRequest } from './mobile-request'

vi.mock('@/native/stream-http', () => ({ createNativeResponse: vi.fn() }))
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: vi.fn() }, registerPlugin: vi.fn() }))

const body = JSON.stringify({ stream: true })
const send = (signal?: AbortSignal) =>
  handleMobileRequest('https://example.com/stream', 'POST', new Headers({ Authorization: 'Bearer test' }), body, signal)

describe('mobile request native streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createNativeResponse).mockResolvedValue(new Response(null, { status: 200 }))
  })
  afterEach(() => vi.useRealTimers())

  test('passes the original signal and preserves response metadata', async () => {
    const controller = new AbortController()
    const response = new Response('data: test\n\n', {
      status: 201,
      headers: { 'content-type': 'text/event-stream', 'x-request-id': 'request' },
    })
    vi.mocked(createNativeResponse).mockResolvedValue(response)
    expect(await send(controller.signal)).toBe(response)
    expect(createNativeResponse).toHaveBeenCalledWith(
      {
        url: 'https://example.com/stream',
        method: 'POST',
        headers: { Accept: 'text/event-stream', authorization: 'Bearer test' },
        body,
      },
      { signal: controller.signal }
    )
  })

  test('preserves API error status, body and retry-after', async () => {
    vi.mocked(createNativeResponse).mockResolvedValue(
      new Response('{"error":"limited"}', { status: 429, headers: { 'retry-after': '20' } })
    )
    await expect(send()).rejects.toMatchObject({
      statusCode: 429,
      retryAfter: '20',
      responseBody: '{"error":"limited"}',
    })
    expect(CapacitorHttp.request).not.toHaveBeenCalled()
  })

  test('does not replay a failed native request', async () => {
    vi.mocked(createNativeResponse).mockRejectedValue(new TypeError('network interrupted'))
    await expect(send()).rejects.toThrow('network interrupted')
    expect(CapacitorHttp.request).not.toHaveBeenCalled()
  })

  test('bounds an endless error body and cancels it', async () => {
    const cancel = vi.fn()
    vi.mocked(createNativeResponse).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(128 * 1024).fill(65))
          },
          cancel,
        }),
        { status: 500 }
      )
    )
    await expect(send()).rejects.toMatchObject({ statusCode: 500, responseBody: 'A'.repeat(64 * 1024) })
    expect(cancel).toHaveBeenCalledOnce()
  })

  test('bounds a stalled error body by time', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    vi.mocked(createNativeResponse).mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 503 }))
    const failed = expect(send()).rejects.toMatchObject({ statusCode: 503, responseBody: '' })
    await vi.advanceTimersByTimeAsync(5_000)
    await failed
    expect(cancel).toHaveBeenCalledOnce()
  })

  test('retains the non-streaming native HTTP path', async () => {
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      headers: {},
      data: '{}',
      url: 'https://example.com',
    })
    expect(await (await handleMobileRequest('https://example.com', 'POST', new Headers(), '{}')).text()).toBe('{}')
    expect(createNativeResponse).not.toHaveBeenCalled()
  })
})
