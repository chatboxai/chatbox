import { describe, expect, it, vi } from 'vitest'
import { KeenableSearch } from './keenable'

describe('KeenableSearch', () => {
  it('reads a webpage through the public fetch endpoint when no API key is set', async () => {
    const search = new KeenableSearch()
    const fetchSpy = vi.spyOn(search, 'fetch').mockResolvedValue({
      url: 'https://example.com/article',
      title: 'Article',
      content: 'The article body.',
    } as never)

    const result = await search.parseLink('https://example.com/article')

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.keenable.ai/v1/fetch/public')
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      query: { url: 'https://example.com/article' },
      headers: { 'X-Keenable-Title': 'Chatbox' },
    })
    expect(result).toEqual({
      url: 'https://example.com/article',
      title: 'Article',
      content: 'The article body.',
    })
  })

  it('reads a webpage through the keyed fetch endpoint once an API key is set', async () => {
    const search = new KeenableSearch('kn-key')
    const fetchSpy = vi
      .spyOn(search, 'fetch')
      .mockResolvedValue({ url: 'https://example.com', title: '', content: 'body' } as never)

    const result = await search.parseLink('https://example.com')

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.keenable.ai/v1/fetch')
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ headers: { 'X-API-Key': 'kn-key' } })
    // No title in the payload, so the URL stands in as the label.
    expect(result.title).toBe('https://example.com')
  })

  it('throws instead of returning an empty page', async () => {
    const search = new KeenableSearch()
    vi.spyOn(search, 'fetch').mockResolvedValue({ url: 'https://example.com', content: '' } as never)

    await expect(search.parseLink('https://example.com')).rejects.toThrow()
  })
})
