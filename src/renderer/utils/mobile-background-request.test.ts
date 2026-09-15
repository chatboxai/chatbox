import { beforeEach, expect, it, vi } from 'vitest'
import { handleMobileRequest } from './mobile-request'

const native = vi.hoisted(() => ({ start: vi.fn(), read: vi.fn(), stream: vi.fn(), unsubscribe: vi.fn() }))
vi.mock('@/native/background-stream', () => ({
  backgroundStreamPrototypeEnabled: true,
  backgroundStreamBridge: native,
  subscribeBackgroundStreamResume: () => native.unsubscribe,
}))
vi.mock('@/native/stream-http', () => ({ createNativeReadableStream: native.stream }))
beforeEach(() => {
  vi.resetAllMocks()
  native.stream.mockReturnValue(
    new ReadableStream({
      start(c) {
        c.close()
      },
    })
  )
})
it('falls back to the existing Capacitor stream only before native dispatch', async () => {
  native.start.mockResolvedValue({ started: false })
  const controller = new AbortController()
  await handleMobileRequest('https://example.test', 'POST', new Headers(), '{"stream":true}', controller.signal)
  expect(native.stream).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ url: 'https://example.test', body: '{"stream":true}' }),
    { signal: controller.signal }
  )
  expect(native.read).not.toHaveBeenCalled()
})
it('does not start a second connection on an ambiguous bridge error', async () => {
  native.start.mockRejectedValue(new Error('Native bridge failed'))
  await expect(handleMobileRequest('https://example.test', 'POST', new Headers(), '{"stream":true}')).rejects.toThrow(
    'Native bridge failed'
  )
  expect(native.stream).not.toHaveBeenCalled()
})
