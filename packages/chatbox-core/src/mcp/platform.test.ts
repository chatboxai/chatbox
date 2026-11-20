import { describe, expect, it, vi } from 'vitest'
import { createMCPFetch } from './platform'

function createFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  return { calls, impl }
}

describe('createMCPFetch', () => {
  it('rejects requests that leave the configured origin', async () => {
    const { impl } = createFetch()
    const request = createMCPFetch('https://mcp.example.com/mcp', impl)
    await expect(request('https://evil.example.com/mcp', {})).rejects.toThrow(/configured server origin/)
  })

  it('advertises both JSON and an event stream even when the caller asks for JSON only', async () => {
    const { calls, impl } = createFetch()
    const request = createMCPFetch('https://mcp.example.com/mcp', impl)
    await request('https://mcp.example.com/mcp', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(calls).toHaveLength(1)
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('accept')).toBe('application/json, text/event-stream')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('keeps an event-stream-only Accept and adds the missing JSON type', async () => {
    const { calls, impl } = createFetch()
    const request = createMCPFetch('https://mcp.example.com/sse', impl)
    await request('https://mcp.example.com/sse', {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    })
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('accept')).toBe('text/event-stream')
  })

  it('supplies the combined Accept header when the caller sends none', async () => {
    const { calls, impl } = createFetch()
    const request = createMCPFetch('https://mcp.example.com/mcp', impl)
    await request('https://mcp.example.com/mcp', { method: 'POST', body: '{}' })
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('accept')).toBe('application/json, text/event-stream')
  })

  it('forces redirects to fail instead of following them', async () => {
    const { calls, impl } = createFetch()
    const request = createMCPFetch('https://mcp.example.com/mcp', impl)
    await request('https://mcp.example.com/mcp', { method: 'POST' })
    expect(calls[0].init.redirect).toBe('error')
    expect(calls[0].init.credentials).toBe('include')
  })

  it('propagates the fetch implementation result', async () => {
    const impl = vi.fn(async () => new Response('{"ok":true}', { status: 201 })) as unknown as typeof fetch
    const request = createMCPFetch('https://mcp.example.com/mcp', impl)
    const response = await request('https://mcp.example.com/mcp', { method: 'POST' })
    expect(response.status).toBe(201)
  })
})
