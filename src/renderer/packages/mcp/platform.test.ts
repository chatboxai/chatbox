import { describe, expect, test, vi } from 'vitest'
import { nativeFetch } from '@/native/native-fetch'
import { createNativeResponse } from '@/native/stream-http'
import { createMCPFetch } from './platform'

vi.mock('@/native/stream-http', () => ({ createNativeResponse: vi.fn() }))

describe('mobile MCP HTTP boundary', () => {
  test('dispatches MCP requests through native fetch with redirect rejection', async () => {
    const response = new Response('{}', { status: 200 })
    vi.mocked(createNativeResponse).mockResolvedValueOnce(response)
    const fetch = createMCPFetch('https://example.com/mcp', nativeFetch)
    expect(await fetch('https://example.com/mcp', { method: 'POST', body: '{"id":1}' })).toBe(response)
    expect(createNativeResponse).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', body: '{"id":1}', redirect: 'error' }),
      { signal: expect.any(AbortSignal) }
    )
  })

  test('passes same-origin GET and POST through native fetch with redirect rejection', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }))
    const fetch = createMCPFetch('https://example.com/sse', fetchImpl)
    await fetch('https://example.com/messages?session=1', { method: 'POST', headers: { authorization: 'Bearer test' } })
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/messages?session=1', {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      redirect: 'error',
      credentials: 'include',
    })
  })
  test('rejects cross-origin SSE endpoints without forwarding credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const fetch = createMCPFetch('https://example.com/sse', fetchImpl)
    await expect(
      fetch('https://other.example/messages', { headers: { authorization: 'Bearer test' } })
    ).rejects.toThrow('configured server origin')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
