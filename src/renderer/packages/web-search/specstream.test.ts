import { describe, expect, it, vi } from 'vitest'
import { SpecStreamSearch } from './specstream'

describe('SpecStreamSearch', () => {
  it('sends a GET with the bearer key and maps sources to result items', async () => {
    const search = new SpecStreamSearch('test-api-key')
    const fetchSpy = vi.spyOn(search, 'fetch').mockResolvedValue({
      data: {
        sources: [
          { title: 'first', url: 'https://example.com/a', snippet: 'about a' },
          { title: '', url: 'https://example.com/skipped', snippet: 'no title' },
          { title: 'second', url: 'https://example.com/b' },
        ],
      },
    } as never)

    const result = await search.search('chatbox & friends')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, options] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBe('https://api.specstream.ai/v1/web-search?q=chatbox%20%26%20friends')
    expect(options?.method).toBe('GET')
    expect(options?.headers).toMatchObject({ authorization: 'Bearer test-api-key' })
    expect(result.items).toEqual([
      { title: 'first', link: 'https://example.com/a', snippet: 'about a' },
      { title: 'second', link: 'https://example.com/b', snippet: '' },
    ])
  })

  it('passes a failed request up to the caller', async () => {
    const search = new SpecStreamSearch('bad-key')
    vi.spyOn(search, 'fetch').mockRejectedValue(new Error('401 Unauthorized'))

    await expect(search.search('test')).rejects.toThrow('401 Unauthorized')
  })

  it('throws when the reply has no sources list', async () => {
    const search = new SpecStreamSearch('test-api-key')
    vi.spyOn(search, 'fetch').mockResolvedValue({ data: {} } as never)

    await expect(search.search('test')).rejects.toThrow('invalid search response')
  })

  it('keeps at most the default number of results', async () => {
    const search = new SpecStreamSearch('test-api-key')
    const sources = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, url: `https://example.com/${i}` }))
    vi.spyOn(search, 'fetch').mockResolvedValue({ data: { sources } } as never)

    const result = await search.search('test')

    expect(result.items).toHaveLength(8)
  })
})
