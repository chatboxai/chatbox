import { describe, expect, test, vi } from 'vitest'
import { FeaturedCopilotClient } from './FeaturedCopilotClient'

function setup() {
  const request = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
  const deviceId = vi.fn(() => Promise.resolve('device-id'))
  const client = new FeaturedCopilotClient({ request, apiOrigin: 'https://api.example.com/', deviceId })
  return { client, request, deviceId }
}

describe('FeaturedCopilotClient', () => {
  test('uses localized tags and forwards query cancellation', async () => {
    const { client, request } = setup()
    request.mockResolvedValue(Response.json({ data: ['Writing'] }))
    const controller = new AbortController()
    expect(await client.tags('zh-Hans', controller.signal)).toEqual(['Writing'])
    expect(request).toHaveBeenCalledExactlyOnceWith('https://api.example.com/api/system_copilots/tags/zh-Hans', {
      method: 'GET',
      signal: controller.signal,
    })
  })

  test.each(['tags', 'list'] as const)('preserves in-flight cancellation for %s requests', async (operation) => {
    const { client, request } = setup()
    const controller = new AbortController()
    const reason = new Error('cancelled')
    request.mockImplementation((_input, init) => {
      expect(init?.signal).toBe(controller.signal)
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
      })
    })
    const pending =
      operation === 'tags' ? client.tags('en', controller.signal) : client.list({ lang: 'en' }, controller.signal)
    const rejected = expect(pending).rejects.toBe(reason)
    controller.abort(reason)
    await rejected
  })

  test('sends cursor, language and filters together with the page size', async () => {
    const { client, request } = setup()
    const page = { data: [{ id: 'one', name: 'One', prompt: 'Write' }], next_cursor: 'next' }
    request.mockResolvedValue(Response.json(page))
    expect(await client.list({ lang: 'en', cursor: 'cursor', tag: 'Writing', search: 'poem' })).toEqual(page)
    expect(request).toHaveBeenCalledWith(
      'https://api.example.com/api/system_copilots/list',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: 'en', cursor: 'cursor', tag: 'Writing', search: 'poem', limit: 18 }),
      })
    )
  })

  test('reports request and payload failures to the query layer for retry', async () => {
    const { client, request } = setup()
    request.mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(client.tags('en')).rejects.toThrow('503')
    request.mockResolvedValueOnce(Response.json({ data: [42] }))
    await expect(client.tags('en')).rejects.toThrow('Invalid')
    request.mockResolvedValueOnce(Response.json({ data: [{ id: 'one' }], next_cursor: null }))
    await expect(client.list({ lang: 'en' })).rejects.toThrow('Invalid')
    request.mockResolvedValueOnce(Response.json({ data: [], next_cursor: 42 }))
    await expect(client.list({ lang: 'en' })).rejects.toThrow('Invalid')
  })

  test.each([{ data: [] }, { data: [{ id: 'one', name: 'One', prompt: 'Write' }] }])(
    'accepts a final page that omits the next cursor ($data.length items)',
    async ({ data }) => {
      const { client, request } = setup()
      request.mockResolvedValue(Response.json({ data, has_more: false }))
      expect(await client.list({ lang: 'zh-Hans', tag: '学习教育' })).toEqual({
        data,
        next_cursor: null,
      })
    }
  )

  test('usage payload matches the existing API and cannot fail the user action', async () => {
    const { client, request, deviceId } = setup()
    request.mockRejectedValue(new Error('offline'))
    await expect(client.recordUsage('one', 'use_copilot')).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledWith(
      'https://api.example.com/api/system_copilots/record_usage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: 'one', action: 'use_copilot', device_id: 'device-id' }),
      })
    )
    deviceId.mockRejectedValueOnce(new Error('device unavailable'))
    await expect(client.recordUsage('one', 'create_session')).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledOnce()
  })
})
