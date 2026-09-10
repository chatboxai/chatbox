import { describe, expect, it, vi } from 'vitest'
import {
  formatNativeWebSearchContext,
  hasNativeWebSearchConfiguration,
  KEENABLE_SNIPPET_MAX_LENGTH,
  searchNativeWeb,
} from './native-web-search'

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

describe('native web search', () => {
  it('detects configuration presence per provider', () => {
    expect(hasNativeWebSearchConfiguration({ provider: 'tavily', apiKey: '' })).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'tavily', apiKey: '  ' })).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'tavily', apiKey: 'tvly-key' })).toBe(true)
    expect(hasNativeWebSearchConfiguration({ provider: 'bing', apiKey: '' })).toBe(true)
    expect(hasNativeWebSearchConfiguration({ provider: 'keenable', apiKey: '' })).toBe(true)
    expect(hasNativeWebSearchConfiguration({ provider: 'build-in', apiKey: '' })).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'build-in', apiKey: '' }, 'license-1')).toBe(true)
  })

  it('searches through the chatbox build-in endpoint with the license key and injected headers', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { links: [{ title: 'Doc', url: 'https://doc.test', content: 'snippet' }] } }),
    })) as unknown as typeof fetch
    const items = await searchNativeWeb('chatbox', {
      provider: 'build-in',
      licenseKey: 'license-1',
      chatboxApiOrigin: 'http://10.0.2.2:8095',
      headers: { 'CHATBOX-PLATFORM': 'web', 'CHATBOX-VERSION': '1.2.3' },
      fetchFn,
    })
    expect(items).toEqual([{ title: 'Doc', link: 'https://doc.test', snippet: 'snippet' }])
    const call = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('http://10.0.2.2:8095/api/tool/web-search')
    expect(call[1].headers.Authorization).toBe('license-1')
    // Injected Chatbox platform headers ride along (renderer afetch/headers parity).
    expect(call[1].headers).toMatchObject({ 'CHATBOX-PLATFORM': 'web', 'CHATBOX-VERSION': '1.2.3' })
  })

  it('surfaces the chatbox error body when the build-in endpoint fails', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'License expired' }),
    })) as unknown as typeof fetch
    await expect(searchNativeWeb('chatbox', { provider: 'build-in', licenseKey: 'bad', fetchFn })).rejects.toThrow(
      'License expired'
    )
  })

  it('extracts bing results without DOMParser', async () => {
    const html = `<ol id="b_results"><li class="b_algo"><h2><a href="https://one.test/page?a=1&amp;b=2">First &amp; Best</a></h2><div class="b_caption"><p>Snippet one</p></div></li><li class="b_algo"><h2><a href="https://two.test">Second<strong> result</strong></a></h2><p class="b_lineclamp2">Snippet two</p></li></ol>`
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => html,
    })) as unknown as typeof fetch
    const items = await searchNativeWeb('chatbox', { provider: 'bing', fetchFn })
    expect(items).toEqual([
      { title: 'First & Best', link: 'https://one.test/page?a=1&b=2', snippet: 'Snippet one' },
      { title: 'Second result', link: 'https://two.test', snippet: 'Snippet two' },
    ])
  })

  it('searches through the tavily-compatible endpoint with an injectable host', async () => {
    const fetchFn = mockFetchResponse({
      results: [
        { title: 'One', url: 'https://one.test', content: 'first snippet' },
        { title: 'Two', url: 'https://two.test', content: 'second snippet' },
        // Link-less results are kept (link: '') and passed to the model, matching the
        // old renderer Tavily provider which returned every result Tavily sent.
        { title: 'No link', content: 'no url' },
      ],
    })
    const items = await searchNativeWeb('chatbox', {
      apiKey: 'key-1',
      apiHost: 'http://10.0.2.2:8091/',
      fetchFn,
    })
    expect(items).toEqual([
      { title: 'One', link: 'https://one.test', snippet: 'first snippet' },
      { title: 'Two', link: 'https://two.test', snippet: 'second snippet' },
      { title: 'No link', link: '', snippet: 'no url' },
    ])
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://10.0.2.2:8091/search')
    expect(JSON.parse((init as RequestInit).body as string).query).toBe('chatbox')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer key-1' })
  })

  it('searches keenable without an API key and names the caller', async () => {
    const fetchFn = mockFetchResponse({
      results: [
        // Keenable sends both fields: `snippet` is the page text, `description` is the
        // page meta description and is empty for most pages.
        { title: 'One', url: 'https://one.test', description: '', snippet: 'first\n  snippet' },
        { title: 'Two', url: 'https://two.test', description: 'meta description', snippet: '' },
      ],
    })
    const items = await searchNativeWeb('chatbox', { provider: 'keenable', fetchFn })
    expect(items).toEqual([
      { title: 'One', link: 'https://one.test', snippet: 'first snippet' },
      { title: 'Two', link: 'https://two.test', snippet: 'meta description' },
    ])
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.keenable.ai/v1/search/public')
    // The public endpoint takes no credentials but requires the caller to name itself.
    expect((init as RequestInit).headers).toMatchObject({ 'X-Keenable-Title': 'Chatbox' })
    expect((init as RequestInit).headers).not.toHaveProperty('X-API-Key')
  })

  it('uses the keyed keenable endpoint once an API key is set', async () => {
    const fetchFn = mockFetchResponse({ results: [] })
    await searchNativeWeb('chatbox', { provider: 'keenable', apiKey: ' kn-key ', fetchFn })
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.keenable.ai/v1/search')
    expect((init as RequestInit).headers).toMatchObject({ 'X-API-Key': 'kn-key' })
  })

  it('caps keenable results, which carry whole page text rather than a serp blurb', async () => {
    const fetchFn = mockFetchResponse({
      results: [{ title: 'Long', url: 'https://long.test', snippet: 'word '.repeat(2000) }],
    })
    const [item] = await searchNativeWeb('chatbox', { provider: 'keenable', fetchFn })
    expect(item.snippet).toHaveLength(KEENABLE_SNIPPET_MAX_LENGTH)
  })

  it('throws on non-ok responses', async () => {
    const fetchFn = mockFetchResponse({}, false, 401)
    await expect(searchNativeWeb('q', { apiKey: 'bad', fetchFn })).rejects.toThrow('status 401')
  })

  it('formats the search context block', () => {
    const context = formatNativeWebSearchContext('chatbox', [
      { title: 'One', link: 'https://one.test', snippet: 'first' },
    ])
    expect(context).toContain('<WEB_SEARCH_RESULTS>')
    expect(context).toContain('query: chatbox')
    expect(context).toContain('https://one.test')
    expect(formatNativeWebSearchContext('chatbox', [])).toBe('')
  })
})
