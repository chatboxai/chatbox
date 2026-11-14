import { afterEach, describe, expect, it, vi } from 'vitest'
import { OutcrawlSearch } from './outcrawl'

const ofetchMock = vi.hoisted(() => vi.fn())
vi.mock('ofetch', () => ({ ofetch: ofetchMock }))

describe('OutcrawlSearch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    ofetchMock.mockReset()
  })

  it('declares parse_link support', () => {
    expect(new OutcrawlSearch('oc-key').supportsParseLink).toBe(true)
  })

  it('searches with the API key and maps hits to search items', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        hits: [{ title: 'Chatbox', url: 'https://chatboxai.app', snippet: 'AI client', rank: 1 }],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new OutcrawlSearch('oc-key').search('chatbox')

    expect(result.items).toEqual([{ title: 'Chatbox', link: 'https://chatboxai.app', snippet: 'AI client' }])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.outcrawl.ai/v1/search')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer oc-key' })
    expect(JSON.parse(init.body as string)).toEqual({ query: 'chatbox' })
  })

  it('rethrows search failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(new OutcrawlSearch('bad').search('chatbox')).rejects.toThrow('status 401')
  })

  it('reads a page as Markdown through the scrape endpoint', async () => {
    ofetchMock.mockResolvedValueOnce({
      url: 'https://example.com/',
      statusCode: 200,
      markdown: '  # Example\n\nBody text  ',
      metadata: { title: 'Example Domain' },
    })
    const signal = new AbortController().signal

    const page = await new OutcrawlSearch('oc-key').parseLink('https://example.com', signal)

    expect(page).toEqual({ url: 'https://example.com/', title: 'Example Domain', content: '# Example\n\nBody text' })
    expect(ofetchMock).toHaveBeenCalledWith('https://api.outcrawl.ai/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer oc-key' },
      body: { url: 'https://example.com', formats: ['markdown'], onlyMainContent: true },
      signal,
    })
  })

  it('falls back to the hostname when the page has no title', async () => {
    ofetchMock.mockResolvedValueOnce({ markdown: 'content', metadata: {} })

    const page = await new OutcrawlSearch('oc-key').parseLink('https://docs.example.com/a')

    expect(page).toEqual({ url: 'https://docs.example.com/a', title: 'docs.example.com', content: 'content' })
  })

  it('throws parse_link_failed when the page has no Markdown', async () => {
    ofetchMock.mockResolvedValue({ url: 'https://example.com/', markdown: '   ' })

    await expect(new OutcrawlSearch('oc-key').parseLink('https://example.com')).rejects.toMatchObject({
      code: 20037,
    })

    ofetchMock.mockResolvedValue({})
    await expect(new OutcrawlSearch('oc-key').parseLink('https://example.com')).rejects.toMatchObject({
      code: 20037,
    })
  })
})
