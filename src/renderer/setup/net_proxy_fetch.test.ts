import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const nativeFetchMock = vi.fn()
const invokeMock = vi.fn()
const originalFetch = globalThis.fetch

describe('net_proxy_fetch renderer override', () => {
  beforeAll(async () => {
    globalThis.fetch = nativeFetchMock as unknown as typeof globalThis.fetch
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:1212', href: 'http://localhost:1212/' },
      electronAPI: { invoke: invokeMock },
    })
    await import('./net_proxy_fetch')
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    nativeFetchMock.mockReset()
    invokeMock.mockReset()
    // The real preload invoke always returns a promise; keep the default
    // mock consistent so fire-and-forget calls (abort) don't blow up.
    invokeMock.mockResolvedValue(undefined)
  })

  function mockProxyResponse(chunks: string[], head: Partial<{ status: number; headers: [string, string][] }> = {}) {
    const encoder = new TextEncoder()
    const remaining = [...chunks]
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'net-proxy:fetch') {
        return {
          status: head.status ?? 200,
          statusText: 'OK',
          headers: head.headers ?? [['content-type', 'text/plain']],
          hasBody: true,
        }
      }
      if (channel === 'net-proxy:read') {
        const next = remaining.shift()
        return next === undefined ? { done: true } : { done: false, chunk: encoder.encode(next) }
      }
      return Promise.resolve(undefined)
    })
  }

  it('passes same-origin requests to the native fetch', async () => {
    nativeFetchMock.mockResolvedValue(new Response('local'))
    await globalThis.fetch('http://localhost:1212/assets/app.js')
    expect(nativeFetchMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('passes non-http schemes to the native fetch', async () => {
    nativeFetchMock.mockResolvedValue(new Response('blob'))
    await globalThis.fetch('blob:http://localhost:1212/some-blob')
    await globalThis.fetch('data:text/plain,hi')
    expect(nativeFetchMock).toHaveBeenCalledTimes(2)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('proxies cross-origin requests and reassembles the streamed body', async () => {
    mockProxyResponse(['hello ', 'world'])
    const response = await globalThis.fetch('https://api.example.com/v1/chat', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test' },
      body: '{"stream":true}',
    })

    expect(nativeFetchMock).not.toHaveBeenCalled()
    const [channel, payload] = invokeMock.mock.calls[0]
    expect(channel).toBe('net-proxy:fetch')
    expect(payload).toMatchObject({
      url: 'https://api.example.com/v1/chat',
      method: 'POST',
      headers: { authorization: 'Bearer sk-test' },
      body: '{"stream":true}',
    })
    expect(typeof payload.id).toBe('string')

    expect(response.status).toBe(200)
    expect(response.url).toBe('https://api.example.com/v1/chat')
    expect(response.headers.get('content-type')).toBe('text/plain')
    await expect(response.text()).resolves.toBe('hello world')
  })

  it('proxies cross-origin requests on the same host but a different port', async () => {
    mockProxyResponse(['ollama'])
    const response = await globalThis.fetch('http://localhost:11434/api/tags')
    expect(invokeMock).toHaveBeenCalled()
    await expect(response.text()).resolves.toBe('ollama')
  })

  it('supports Request objects including their body', async () => {
    mockProxyResponse(['ok'])
    const request = new Request('https://api.example.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"input":"x"}',
    })
    await globalThis.fetch(request)
    const [, payload] = invokeMock.mock.calls[0]
    expect(payload.method).toBe('POST')
    expect(payload.headers['content-type']).toBe('application/json')
    expect(new TextDecoder().decode(payload.body)).toBe('{"input":"x"}')
  })

  it('serializes URLSearchParams bodies and sets the form content type', async () => {
    mockProxyResponse(['ok'])
    await globalThis.fetch('https://api.example.com/token', {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token' }),
    })
    const [, payload] = invokeMock.mock.calls[0]
    expect(payload.body).toBe('grant_type=refresh_token')
    expect(payload.headers['content-type']).toContain('application/x-www-form-urlencoded')
  })

  it('serializes binary bodies as Uint8Array', async () => {
    mockProxyResponse(['ok'])
    const bytes = new Uint8Array([1, 2, 3])
    await globalThis.fetch('https://api.example.com/upload', { method: 'POST', body: bytes })
    const [, payload] = invokeMock.mock.calls[0]
    expect(payload.body).toBeInstanceOf(Uint8Array)
    expect([...payload.body]).toEqual([1, 2, 3])
  })

  it('rejects unsupported body types loudly', async () => {
    await expect(
      globalThis.fetch('https://api.example.com/upload', { method: 'POST', body: new FormData() })
    ).rejects.toThrow(/unsupported request body type/)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('returns a bodyless response when the proxy reports none', async () => {
    invokeMock.mockResolvedValue({ status: 204, statusText: 'No Content', headers: [], hasBody: false })
    const response = await globalThis.fetch('https://api.example.com/delete', { method: 'DELETE' })
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
  })

  it('resolves with the response for non-ok statuses instead of throwing', async () => {
    mockProxyResponse(['{"error":"rate limited"}'], { status: 429 })
    const response = await globalThis.fetch('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    expect(response.ok).toBe(false)
    expect(response.status).toBe(429)
    await expect(response.text()).resolves.toBe('{"error":"rate limited"}')
  })

  it('throws an AbortError immediately for pre-aborted signals', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      globalThis.fetch('https://api.example.com/v1/chat', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('honors an abort that lands during async body serialization', async () => {
    const controller = new AbortController()
    const pending = globalThis.fetch('https://api.example.com/v1/chat', {
      method: 'POST',
      body: new Blob(['payload']),
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(invokeMock.mock.calls.some(([channel]) => channel === 'net-proxy:fetch')).toBe(false)
  })

  it('maps an abort during the request to an AbortError and notifies the proxy', async () => {
    const controller = new AbortController()
    let rejectFetch: (error: Error) => void = () => {}
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'net-proxy:fetch') {
        return new Promise((_resolve, reject) => {
          rejectFetch = reject
        })
      }
      return Promise.resolve()
    })

    const pending = globalThis.fetch('https://api.example.com/v1/chat', { signal: controller.signal })
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalled()
    })
    controller.abort()
    rejectFetch(new Error('net-proxy: aborted by renderer'))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(invokeMock.mock.calls.some(([channel]) => channel === 'net-proxy:abort')).toBe(true)
  })

  it('maps proxy failures to TypeError like native fetch network errors', async () => {
    invokeMock.mockRejectedValue(new Error('net-proxy: scheme not allowed: ftp:'))
    await expect(globalThis.fetch('https://api.example.com/v1/chat')).rejects.toBeInstanceOf(TypeError)
  })

  it('cancels the proxy stream when the response body is cancelled', async () => {
    mockProxyResponse(['chunk1', 'chunk2', 'chunk3'])
    const response = await globalThis.fetch('https://api.example.com/v1/stream')
    await response.body?.cancel()
    expect(invokeMock.mock.calls.some(([channel]) => channel === 'net-proxy:abort')).toBe(true)
  })
})
