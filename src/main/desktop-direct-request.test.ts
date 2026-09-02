import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { FetchImplementation } from '../shared/request/request'

const ipcHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler)
    }),
  },
  net: { fetch: vi.fn(), request: vi.fn() },
}))

import { DESKTOP_DIRECT_REQUEST_CHANNELS } from '../shared/desktop-direct-request'
import { DesktopDirectRequestManager, registerDesktopDirectRequestHandlers } from './desktop-direct-request'

describe('DesktopDirectRequestManager', () => {
  it('streams the original response without adding renderer or relay headers', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('hello', {
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'text/event-stream', 'x-response': 'direct' },
        })
    ) as FetchImplementation
    const manager = new DesktopDirectRequestManager(fetchImpl)

    const metadata = await manager.start(1, {
      requestId: 'request-1',
      url: 'https://provider.example/v1/chat',
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: '{"stream":true}',
    })

    expect(fetchImpl).toHaveBeenCalledWith('https://provider.example/v1/chat', {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: '{"stream":true}',
      signal: expect.any(AbortSignal),
    })
    expect(metadata).toEqual({
      status: 201,
      statusText: 'Created',
      headers: [
        ['content-type', 'text/event-stream'],
        ['x-response', 'direct'],
      ],
      hasBody: true,
    })

    const first = await manager.read(1, 'request-1')
    expect(first.done).toBe(false)
    if (!first.done) {
      expect(new TextDecoder().decode(first.chunk)).toBe('hello')
    }
    await expect(manager.read(1, 'request-1')).resolves.toEqual({ done: true })
  })

  it('aborts an in-flight request when the renderer cancels it', async () => {
    let receivedSignal: AbortSignal | undefined
    const fetchImpl: FetchImplementation = (_url, init) => {
      receivedSignal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        receivedSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    }
    const manager = new DesktopDirectRequestManager(fetchImpl)
    const startPromise = manager.start(7, {
      requestId: 'request-2',
      url: 'https://provider.example/v1/chat',
      method: 'POST',
      headers: {},
    })

    await manager.cancel(7, 'request-2')

    expect(receivedSignal?.aborted).toBe(true)
    await expect(startPromise).rejects.toThrow('aborted')
  })

  it('rejects non-HTTP targets before starting a request', async () => {
    const fetchImpl = vi.fn() as FetchImplementation
    const manager = new DesktopDirectRequestManager(fetchImpl)

    await expect(
      manager.start(1, {
        requestId: 'request-3',
        url: 'file:///tmp/provider-response',
        method: 'GET',
        headers: {},
      })
    ).rejects.toThrow('Unsupported desktop direct request protocol: file:')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('cancels owner requests when the renderer reloads, crashes, or is destroyed', () => {
    const manager = {
      start: vi.fn(),
      read: vi.fn(),
      cancel: vi.fn(),
      cancelOwner: vi.fn(),
    } as unknown as DesktopDirectRequestManager
    registerDesktopDirectRequestHandlers(manager)
    const startHandler = ipcHandlers.get(DESKTOP_DIRECT_REQUEST_CHANNELS.start)
    expect(startHandler).toBeDefined()

    const sender = new EventEmitter() as EventEmitter & { id: number }
    sender.id = 42
    startHandler?.(
      { sender },
      {
        requestId: 'request-4',
        url: 'https://provider.example/v1/chat',
        method: 'POST',
        headers: {},
      }
    )

    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    sender.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    expect(manager.cancelOwner).not.toHaveBeenCalled()

    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    sender.emit('render-process-gone')
    sender.emit('destroyed')
    expect(manager.cancelOwner).toHaveBeenNthCalledWith(1, 42)
    expect(manager.cancelOwner).toHaveBeenNthCalledWith(2, 42)
    expect(manager.cancelOwner).toHaveBeenNthCalledWith(3, 42)
  })
})
