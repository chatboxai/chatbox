import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createNativeReadableStream } from '@/native/stream-http'
import { handleMobileRequest } from './mobile-request'

vi.mock('@/native/stream-http', () => ({
  createNativeReadableStream: vi.fn(),
}))

describe('mobile request native streaming', () => {
  beforeEach(() => {
    vi.mocked(createNativeReadableStream).mockReset()
    vi.mocked(createNativeReadableStream).mockReturnValue(new ReadableStream<Uint8Array>())
  })

  test('passes the request signal directly to the native stream', async () => {
    const abortController = new AbortController()

    await handleMobileRequest(
      'https://example.com/stream',
      'POST',
      new Headers({ Authorization: 'Bearer test' }),
      JSON.stringify({ stream: true }),
      abortController.signal
    )

    expect(createNativeReadableStream).toHaveBeenCalledWith(
      {
        url: 'https://example.com/stream',
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          authorization: 'Bearer test',
        },
        body: JSON.stringify({ stream: true }),
      },
      { signal: abortController.signal }
    )
  })

  test('passes an already-aborted signal to native stream setup', async () => {
    const abortController = new AbortController()
    abortController.abort(123_456)

    await handleMobileRequest(
      'https://example.com/stream',
      'POST',
      new Headers(),
      JSON.stringify({ stream: true }),
      abortController.signal
    )

    expect(createNativeReadableStream).toHaveBeenCalledWith(expect.any(Object), {
      signal: abortController.signal,
    })
  })

  test('passes an explicit undefined signal to native stream setup', async () => {
    await handleMobileRequest('https://example.com/stream', 'POST', new Headers(), JSON.stringify({ stream: true }))

    expect(createNativeReadableStream).toHaveBeenCalledWith(expect.any(Object), { signal: undefined })
  })
})
