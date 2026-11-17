import { beforeEach, describe, expect, test, vi } from 'vitest'
import { nativeFetch } from './native-fetch'
import { createNativeResponse } from './stream-http'

vi.mock('./stream-http', () => ({ createNativeResponse: vi.fn() }))

beforeEach(() => {
  vi.mocked(createNativeResponse).mockReset()
  vi.mocked(createNativeResponse).mockResolvedValue(new Response('{}'))
})

describe('nativeFetch', () => {
  test.each(['GET', 'DELETE'])('supports a %s request with no body', async (method) => {
    await nativeFetch(new URL('https://example.com/mcp'), { method, headers: { 'Mcp-Session-Id': 'session' } })
    expect(createNativeResponse).toHaveBeenCalledWith(
      {
        url: 'https://example.com/mcp',
        method,
        headers: { 'mcp-session-id': 'session' },
        body: undefined,
        redirect: 'follow',
      },
      { signal: expect.any(AbortSignal) }
    )
  })

  test('uses Request body and headers while applying init overrides', async () => {
    const input = new Request('https://example.com/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer original', 'content-type': 'application/json' },
      body: '{"id":1}',
    })
    await nativeFetch(input, { headers: { authorization: 'Bearer override' }, body: '{"id":2}' })
    expect(createNativeResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        body: '{"id":2}',
        headers: expect.objectContaining({ authorization: 'Bearer override' }),
      }),
      expect.any(Object)
    )
  })

  test.each([401, 403, 404, 405, 429, 500])('returns HTTP %s responses for SDK handling', async (status) => {
    const response = new Response('failed', { status, headers: { 'www-authenticate': 'Bearer' } })
    vi.mocked(createNativeResponse).mockResolvedValue(response)
    expect(await nativeFetch('https://example.com/mcp')).toBe(response)
  })

  test('propagates the supplied abort signal', async () => {
    const controller = new AbortController()
    await nativeFetch('https://example.com/mcp', { signal: controller.signal })
    const signal = vi.mocked(createNativeResponse).mock.calls[0][1]?.signal
    controller.abort()
    expect(signal?.aborted).toBe(true)
  })

  test('does not start an already cancelled request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(nativeFetch('https://example.com', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(createNativeResponse).not.toHaveBeenCalled()
  })

  test('rejects unsupported schemes before reaching the native plugin', async () => {
    await expect(nativeFetch('file:///etc/hosts')).rejects.toThrow('HTTP or HTTPS')
    expect(createNativeResponse).not.toHaveBeenCalled()
  })

  test.each(['follow', 'error'] as const)('forwards the %s redirect policy to the native plugin', async (redirect) => {
    await nativeFetch(new Request('https://example.com/mcp', { redirect }))
    expect(createNativeResponse).toHaveBeenCalledWith(expect.objectContaining({ redirect }), {
      signal: expect.any(AbortSignal),
    })
  })

  test('rejects manual redirects before reaching the native plugin', async () => {
    await expect(nativeFetch('https://example.com', { redirect: 'manual' })).rejects.toThrow('manual redirects')
    expect(createNativeResponse).not.toHaveBeenCalled()
  })
})
