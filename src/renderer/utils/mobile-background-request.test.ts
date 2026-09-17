import { beforeEach, expect, it, vi } from 'vitest'
import { handleMobileRequest } from './mobile-request'

const native = vi.hoisted(() => ({ start: vi.fn(), read: vi.fn(), response: vi.fn(), unsubscribe: vi.fn() }))
vi.mock('@/native/background-stream', () => ({
  backgroundStreamPrototypeEnabled: true,
  backgroundStreamBridge: native,
  subscribeBackgroundStreamResume: () => native.unsubscribe,
}))
vi.mock('@/native/stream-http', () => ({ createNativeResponse: native.response }))
beforeEach(() => {
  vi.resetAllMocks()
  native.response.mockResolvedValue(new Response(null, { status: 200 }))
})
it('falls back to the existing Capacitor stream only before native dispatch', async () => {
  native.start.mockResolvedValue({ started: false })
  const response = new Response('data: test\n\n', { status: 201, headers: { 'content-type': 'text/event-stream' } })
  native.response.mockResolvedValue(response)
  const controller = new AbortController()
  expect(
    await handleMobileRequest('https://example.test', 'POST', new Headers(), '{"stream":true}', controller.signal)
  ).toBe(response)
  expect(native.response).toHaveBeenCalledExactlyOnceWith(
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
  expect(native.response).not.toHaveBeenCalled()
})
