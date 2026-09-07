import { describe, expect, it, vi } from 'vitest'
import { RendererRequestAdapter } from './RendererRequestAdapter'

describe('RendererRequestAdapter', () => {
  it('forwards fetch init and retry options unchanged', async () => {
    const response = new Response('ok')
    const fetchWithOptions = vi.fn(() => Promise.resolve(response))
    const adapter = new RendererRequestAdapter(fetchWithOptions, {
      post: vi.fn(),
      get: vi.fn(),
    })
    const init: RequestInit = { method: 'PATCH', headers: { 'x-test': 'fetch' } }
    const options = { retry: 2, parseChatboxRemoteError: true }

    await expect(adapter.fetchWithOptions('https://example.com', init, options)).resolves.toBe(response)
    expect(fetchWithOptions).toHaveBeenCalledWith('https://example.com', init, options)
  })

  it('preserves POST headers, body, signal, retry and proxy flags', async () => {
    const response = new Response('created')
    const post = vi.fn(() => Promise.resolve(response))
    const get = vi.fn(() => Promise.resolve(response))
    const adapter = new RendererRequestAdapter(vi.fn(), { post, get })
    const controller = new AbortController()

    await adapter.apiRequest({
      url: 'https://example.com/v1/chat',
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      body: '{"message":"hello"}',
      signal: controller.signal,
      retry: 3,
      useProxy: true,
    })

    expect(post).toHaveBeenCalledWith(
      'https://example.com/v1/chat',
      { authorization: 'Bearer test' },
      '{"message":"hello"}',
      {
        signal: controller.signal,
        retry: 3,
        useProxy: true,
      }
    )
    expect(get).not.toHaveBeenCalled()
  })

  it('uses the GET bridge for every non-POST request', async () => {
    const response = new Response('ok')
    const get = vi.fn(() => Promise.resolve(response))
    const adapter = new RendererRequestAdapter(vi.fn(), {
      post: vi.fn(),
      get,
    })

    await adapter.apiRequest({
      url: 'https://example.com/models',
      headers: { 'x-test': 'models' },
      retry: 1,
      useProxy: false,
    })

    expect(get).toHaveBeenCalledWith(
      'https://example.com/models',
      { 'x-test': 'models' },
      {
        signal: undefined,
        retry: 1,
        useProxy: false,
      }
    )
  })
})
