import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_DIRECT_REQUEST_CHANNELS } from '../../shared/desktop-direct-request'
import { desktopDirectRequest } from './desktop-direct-request'

describe('desktopDirectRequest', () => {
  it('reconstructs a streaming Response through pull-based IPC reads', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'text/event-stream']],
        hasBody: true,
      })
      .mockResolvedValueOnce({ done: false, chunk: new TextEncoder().encode('data: hello\n\n') })
      .mockResolvedValueOnce({ done: true })

    const response = await desktopDirectRequest(
      { invoke },
      'https://provider.example/v1/chat',
      'POST',
      new Headers({ authorization: 'Bearer secret' }),
      '{"stream":true}'
    )

    await expect(response.text()).resolves.toBe('data: hello\n\n')
    expect(invoke.mock.calls[0][0]).toBe(DESKTOP_DIRECT_REQUEST_CHANNELS.start)
    expect(invoke.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        url: 'https://provider.example/v1/chat',
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
        body: '{"stream":true}',
      })
    )
    expect(invoke.mock.calls.slice(1).map(([channel]) => channel)).toEqual([
      DESKTOP_DIRECT_REQUEST_CHANNELS.read,
      DESKTOP_DIRECT_REQUEST_CHANNELS.read,
    ])
  })

  it('surfaces read-time IPC failures through the response stream', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'text/event-stream']],
        hasBody: true,
      })
      .mockRejectedValueOnce(new Error('main stream read failed'))
      .mockResolvedValueOnce(undefined)

    const response = await desktopDirectRequest(
      { invoke },
      'https://provider.example/v1/chat',
      'POST',
      new Headers(),
      '{"stream":true}'
    )

    await expect(response.text()).rejects.toThrow('main stream read failed')
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      DESKTOP_DIRECT_REQUEST_CHANNELS.start,
      DESKTOP_DIRECT_REQUEST_CHANNELS.read,
      DESKTOP_DIRECT_REQUEST_CHANNELS.cancel,
    ])
  })

  it('rejects an active response stream with AbortError and cancels Main', async () => {
    const controller = new AbortController()
    const invoke = vi.fn((channel: string) => {
      if (channel === DESKTOP_DIRECT_REQUEST_CHANNELS.start) {
        return Promise.resolve({ status: 200, statusText: 'OK', headers: [], hasBody: true })
      }
      if (channel === DESKTOP_DIRECT_REQUEST_CHANNELS.read) {
        return new Promise(() => undefined)
      }
      return Promise.resolve()
    })

    const response = await desktopDirectRequest(
      { invoke },
      'https://provider.example/v1/chat',
      'POST',
      new Headers(),
      undefined,
      controller.signal
    )
    const body = response.text()
    await Promise.resolve()
    controller.abort()

    await expect(body).rejects.toMatchObject({ name: 'AbortError' })
    expect(invoke).toHaveBeenCalledWith(DESKTOP_DIRECT_REQUEST_CHANNELS.cancel, expect.any(String))
  })

  it('cancels the main-process request when aborted', async () => {
    const controller = new AbortController()
    let resolveStart: ((value: unknown) => void) | undefined
    const invoke = vi.fn((channel: string) => {
      if (channel === DESKTOP_DIRECT_REQUEST_CHANNELS.start) {
        return new Promise((resolve) => {
          resolveStart = resolve
        })
      }
      return Promise.resolve()
    })

    const request = desktopDirectRequest(
      { invoke },
      'https://provider.example/v1/chat',
      'POST',
      new Headers(),
      undefined,
      controller.signal
    )
    await Promise.resolve()
    controller.abort()
    resolveStart?.({ status: 200, statusText: 'OK', headers: [], hasBody: false })

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(invoke).toHaveBeenCalledWith(DESKTOP_DIRECT_REQUEST_CHANNELS.cancel, expect.any(String))
  })

  it('does not start a request when aborted while preparing the payload', async () => {
    const controller = new AbortController()
    const invoke = vi.fn()

    const request = desktopDirectRequest(
      { invoke },
      'https://provider.example/v1/chat',
      'POST',
      new Headers(),
      undefined,
      controller.signal
    )
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(invoke).not.toHaveBeenCalled()
  })
})
