import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
  sesFetch: vi.fn(),
  appOn: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload?: unknown) => unknown) => {
      mocks.handlers.set(channel, handler)
    },
  },
  session: { defaultSession: { fetch: mocks.sesFetch } },
  app: { on: mocks.appOn },
}))

import { registerNetProxyHandlers } from './net-proxy'

interface FetchHead {
  status: number
  statusText: string
  headers: [string, string][]
  hasBody: boolean
}

interface ReadResult {
  done: boolean
  chunk?: Uint8Array
}

let nextId = 0
function uniqueId() {
  nextId += 1
  return `stream-${nextId}`
}

function makeEvent(senderId = 1, destroyed = false) {
  return { sender: { id: senderId, isDestroyed: () => destroyed } }
}

async function invoke(channel: string, event: ReturnType<typeof makeEvent>, payload?: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return await handler(event, payload)
}

async function fetchHead(event: ReturnType<typeof makeEvent>, payload: unknown): Promise<FetchHead> {
  return (await invoke('net-proxy:fetch', event, payload)) as FetchHead
}

async function readAll(event: ReturnType<typeof makeEvent>, id: string): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const result = (await invoke('net-proxy:read', event, id)) as ReadResult
    if (result.done) return text
    text += decoder.decode(result.chunk, { stream: true })
  }
}

describe('net-proxy main handlers', () => {
  beforeAll(() => {
    registerNetProxyHandlers()
  })

  beforeEach(() => {
    mocks.sesFetch.mockReset()
  })

  it('rejects non-http(s) schemes, malformed urls, and invalid payloads', async () => {
    const event = makeEvent()
    await expect(invoke('net-proxy:fetch', event, { id: uniqueId(), url: 'file:///etc/passwd' })).rejects.toThrow(
      /scheme not allowed/
    )
    await expect(invoke('net-proxy:fetch', event, { id: uniqueId(), url: 'app://internal' })).rejects.toThrow(
      /scheme not allowed/
    )
    await expect(invoke('net-proxy:fetch', event, { id: uniqueId(), url: 'not a url' })).rejects.toThrow(/malformed/)
    await expect(invoke('net-proxy:fetch', event, null)).rejects.toThrow(/invalid request payload/)
    await expect(invoke('net-proxy:fetch', event, { id: 42, url: 'https://api.example.com' })).rejects.toThrow(
      /invalid stream id/
    )
    expect(mocks.sesFetch).not.toHaveBeenCalled()
  })

  it('forwards request fields, omits credentials, and streams the response body', async () => {
    mocks.sesFetch.mockResolvedValue(
      new Response('hello world', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain', 'content-encoding': 'gzip', 'x-request-id': 'r-1' },
      })
    )
    const event = makeEvent()
    const id = uniqueId()
    const head = await fetchHead(event, {
      id,
      url: 'https://api.example.com/v1/chat',
      method: 'POST',
      headers: { authorization: 'Bearer sk-test' },
      body: '{"stream":true}',
    })

    expect(mocks.sesFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat',
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer sk-test' },
        body: '{"stream":true}',
        credentials: 'omit',
      })
    )
    expect(head.status).toBe(200)
    expect(head.hasBody).toBe(true)
    const headerNames = head.headers.map(([name]) => name)
    expect(headerNames).toContain('content-type')
    expect(headerNames).toContain('x-request-id')
    expect(headerNames).not.toContain('content-encoding')

    await expect(readAll(event, id)).resolves.toBe('hello world')
    // Stream is cleaned up after done.
    await expect(invoke('net-proxy:read', event, id)).rejects.toThrow(/unknown stream/)
  })

  it('reports hasBody:false for bodyless responses', async () => {
    mocks.sesFetch.mockResolvedValue(new Response(null, { status: 204 }))
    const event = makeEvent()
    const head = await fetchHead(event, { id: uniqueId(), url: 'https://api.example.com/ok' })
    expect(head.hasBody).toBe(false)
  })

  it('rejects a duplicate stream id while the first is open', async () => {
    mocks.sesFetch.mockResolvedValue(new Response('body'))
    const event = makeEvent()
    const id = uniqueId()
    await invoke('net-proxy:fetch', event, { id, url: 'https://api.example.com/a' })
    await expect(invoke('net-proxy:fetch', event, { id, url: 'https://api.example.com/b' })).rejects.toThrow(
      /duplicate stream id/
    )
    await invoke('net-proxy:abort', event, id)
  })

  it('scopes streams per sender', async () => {
    mocks.sesFetch.mockResolvedValue(new Response('body'))
    const id = uniqueId()
    await invoke('net-proxy:fetch', makeEvent(1), { id, url: 'https://api.example.com/a' })
    await expect(invoke('net-proxy:read', makeEvent(2), id)).rejects.toThrow(/unknown stream/)
    await invoke('net-proxy:abort', makeEvent(1), id)
  })

  it('abort cancels an open response stream', async () => {
    mocks.sesFetch.mockResolvedValue(new Response('streaming body'))
    const event = makeEvent()
    const id = uniqueId()
    await invoke('net-proxy:fetch', event, { id, url: 'https://api.example.com/stream' })
    await invoke('net-proxy:abort', event, id)
    await expect(invoke('net-proxy:read', event, id)).rejects.toThrow(/unknown stream/)
  })

  it('abort reaches a fetch that has not produced headers yet', async () => {
    mocks.sesFetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('fetch aborted')))
        })
    )
    const event = makeEvent()
    const id = uniqueId()
    const pending = invoke('net-proxy:fetch', event, { id, url: 'https://api.example.com/slow' })
    await invoke('net-proxy:abort', event, id)
    await expect(pending).rejects.toThrow('fetch aborted')
  })

  it('drops response streams that sit idle past the timeout', async () => {
    vi.useFakeTimers()
    try {
      mocks.sesFetch.mockResolvedValue(new Response('idle body'))
      const event = makeEvent()
      const id = uniqueId()
      await invoke('net-proxy:fetch', event, { id, url: 'https://api.example.com/idle' })
      vi.advanceTimersByTime(120_001)
      await expect(invoke('net-proxy:read', event, id)).rejects.toThrow(/unknown stream/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts the body when the renderer is gone by the time headers arrive', async () => {
    mocks.sesFetch.mockResolvedValue(new Response('late body'))
    const event = makeEvent(1, true)
    const id = uniqueId()
    const head = await fetchHead(event, { id, url: 'https://api.example.com/late' })
    expect(head.hasBody).toBe(false)
    await expect(invoke('net-proxy:read', event, id)).rejects.toThrow(/unknown stream/)
  })
})
