import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ofetchMock } = vi.hoisted(() => ({
  ofetchMock: vi.fn(),
}))

vi.mock('ofetch', () => ({
  ofetch: ofetchMock,
}))

import { FirecrawlSearch } from './firecrawl'

describe('FirecrawlSearch', () => {
  beforeEach(() => {
    ofetchMock.mockReset()
  })

  it('supports parse_link', () => {
    expect(new FirecrawlSearch('fc-key').supportsParseLink).toBe(true)
  })

  it('reads a webpage through the scrape endpoint as markdown', async () => {
    ofetchMock.mockResolvedValueOnce({
      success: true,
      data: {
        markdown: '# Example Domain',
        metadata: { title: 'Example Domain', sourceURL: 'https://example.com' },
      },
    })

    const result = await new FirecrawlSearch('fc-key').parseLink('https://example.com')

    expect(ofetchMock).toHaveBeenCalledWith('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fc-key' },
      body: { url: 'https://example.com', formats: ['markdown'], origin: 'chatbox' },
      signal: undefined,
    })
    expect(result).toEqual({ url: 'https://example.com', title: 'Example Domain', content: '# Example Domain' })
  })

  it('prefers the final URL and falls back to the hostname for the title', async () => {
    ofetchMock.mockResolvedValueOnce({
      success: true,
      data: {
        markdown: 'body',
        metadata: { url: 'https://docs.example.com/page/', sourceURL: 'https://docs.example.com/page' },
      },
    })

    const result = await new FirecrawlSearch('fc-key').parseLink('https://docs.example.com/page')

    expect(result).toEqual({ url: 'https://docs.example.com/page/', title: 'docs.example.com', content: 'body' })
  })

  it('throws parse_link_failed with the Firecrawl error when the scrape fails', async () => {
    ofetchMock.mockResolvedValueOnce({ success: false, error: 'DNS resolution failed' })

    await expect(new FirecrawlSearch('fc-key').parseLink('https://nope.invalid')).rejects.toMatchObject({
      message: 'Firecrawl scrape failed for https://nope.invalid: DNS resolution failed',
      detail: { name: 'parse_link_failed' },
    })
  })

  it('throws parse_link_failed when the scrape returns no content', async () => {
    ofetchMock.mockResolvedValueOnce({ success: true, data: { markdown: '  ', metadata: {} } })

    await expect(new FirecrawlSearch('fc-key').parseLink('https://empty.example.com')).rejects.toMatchObject({
      message: 'Firecrawl scrape failed for https://empty.example.com: no content returned',
      detail: { name: 'parse_link_failed' },
    })
  })
})
