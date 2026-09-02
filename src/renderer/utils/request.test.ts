import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  platform: { type: 'desktop', getVersion: vi.fn(async () => '1.0.0') },
  desktopDirectRequest: vi.fn(),
  mobileRequest: vi.fn(),
}))

vi.mock('@/platform', () => ({ default: mocks.platform }))
vi.mock('./desktop-direct-request', () => ({ desktopDirectRequestFromWindow: mocks.desktopDirectRequest }))
vi.mock('./mobile-request', () => ({ handleMobileRequest: mocks.mobileRequest }))

import { apiRequest } from './request'

describe('provider API request routing', () => {
  afterEach(() => {
    mocks.platform.type = 'desktop'
    mocks.platform.getVersion.mockClear()
    mocks.desktopDirectRequest.mockReset()
    mocks.mobileRequest.mockReset()
    vi.unstubAllGlobals()
  })

  it('uses the main-process direct transport for remote desktop targets when compatibility is enabled', async () => {
    const response = new Response('ok')
    mocks.desktopDirectRequest.mockResolvedValue(response)
    const rendererFetch = vi.fn()
    vi.stubGlobal('fetch', rendererFetch)

    await expect(
      apiRequest.post('https://provider.example/v1/chat', { authorization: 'Bearer secret' }, '{"stream":true}', {
        useProxy: true,
        retry: 0,
      })
    ).resolves.toBe(response)

    expect(mocks.desktopDirectRequest).toHaveBeenCalledWith(
      'https://provider.example/v1/chat',
      'POST',
      expect.any(Headers),
      '{"stream":true}',
      undefined
    )
    const headers = mocks.desktopDirectRequest.mock.calls[0][2] as Headers
    expect(headers.get('CHATBOX-TARGET-URI')).toBeNull()
    expect(rendererFetch).not.toHaveBeenCalled()
  })

  it('keeps local desktop targets in the renderer', async () => {
    const response = new Response('ok')
    const rendererFetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', rendererFetch)

    await expect(apiRequest.get('http://127.0.0.1:11434/api/tags', {}, { useProxy: true, retry: 0 })).resolves.toBe(
      response
    )

    expect(rendererFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.objectContaining({ method: 'GET' })
    )
    expect(mocks.desktopDirectRequest).not.toHaveBeenCalled()
  })

  it('preserves the ApiError contract for failed desktop direct responses', async () => {
    mocks.desktopDirectRequest.mockResolvedValue(new Response('upstream unavailable', { status: 503 }))

    const request = apiRequest.get('https://provider.example/v1/models', {}, { useProxy: true, retry: 0 })

    await expect(request).rejects.toMatchObject({
      message: 'API Error: Status Code 503',
      responseBody: 'upstream unavailable',
    })
  })

  it('preserves AbortError without retrying a cancelled desktop direct request', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    mocks.desktopDirectRequest.mockRejectedValue(abortError)

    const request = apiRequest.get('https://provider.example/v1/models', {}, { useProxy: true, retry: 3 })

    await expect(request).rejects.toBe(abortError)
    expect(mocks.desktopDirectRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps the relay behavior for remote web targets', async () => {
    mocks.platform.type = 'web'
    const response = new Response('ok')
    const rendererFetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', rendererFetch)

    await apiRequest.get('https://provider.example/v1/models', {}, { useProxy: true, retry: 0 })

    expect(rendererFetch).toHaveBeenCalledWith(
      'https://cors-proxy.chatboxai.app/proxy-api/completions',
      expect.objectContaining({ method: 'GET' })
    )
    const headers = rendererFetch.mock.calls[0][1].headers as Headers
    expect(headers.get('CHATBOX-TARGET-URI')).toBe('https://provider.example/v1/models')
    expect(mocks.desktopDirectRequest).not.toHaveBeenCalled()
  })
})
