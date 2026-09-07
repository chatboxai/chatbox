import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { electronFetch, electronRequest } = vi.hoisted(() => ({
  electronFetch: vi.fn(),
  electronRequest: vi.fn(),
}))

vi.mock('electron', () => ({
  net: {
    fetch: electronFetch,
    request: electronRequest,
  },
}))

import { desktopSessionFetch, mainFetch } from './main-fetch'

describe('mainFetch', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    electronFetch.mockReset()
    electronRequest.mockReset()
  })

  it('uses Electron net.request for HarmonyOS builds', async () => {
    vi.stubEnv('CHATBOX_BUILD_TARGET', 'harmony_app')

    const request = new EventEmitter() as EventEmitter & {
      end: ReturnType<typeof vi.fn>
      abort: ReturnType<typeof vi.fn>
    }
    request.end = vi.fn()
    request.abort = vi.fn()
    electronRequest.mockReturnValue(request)

    const responsePromise = mainFetch('https://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"test":true}',
    })
    await Promise.resolve()
    const incoming = new EventEmitter() as EventEmitter & {
      headers: Record<string, string | string[]>
      statusCode: number
      statusMessage: string
    }
    incoming.headers = { 'content-type': 'application/json' }
    incoming.statusCode = 200
    incoming.statusMessage = 'OK'
    request.emit('response', incoming)
    incoming.emit('data', Buffer.from('{"ok":true}'))
    incoming.emit('end')

    const response = await responsePromise
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(electronRequest).toHaveBeenCalledWith({
      url: 'https://example.com',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: undefined,
      redirect: undefined,
    })
    expect(request.end).toHaveBeenCalledWith(Buffer.from('{"test":true}'))
  })

  it('uses the global fetch implementation for other builds', async () => {
    vi.stubEnv('CHATBOX_BUILD_TARGET', 'desktop')
    const response = new Response('ok')
    const globalFetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', globalFetch)

    await expect(mainFetch(new URL('https://example.com/path'))).resolves.toBe(response)
    expect(globalFetch).toHaveBeenCalledWith(new URL('https://example.com/path'), undefined)
    expect(electronRequest).not.toHaveBeenCalled()
  })

  it('uses Electron default-session fetch for desktop compatibility requests', async () => {
    const response = new Response('ok')
    electronFetch.mockResolvedValue(response)
    const init: RequestInit = { headers: { authorization: 'Bearer secret' } }

    await expect(desktopSessionFetch(new URL('https://provider.example/v1/models'), init)).resolves.toBe(response)

    expect(electronFetch).toHaveBeenCalledWith('https://provider.example/v1/models', init)
  })
})
