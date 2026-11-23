import { describe, expect, it, vi } from 'vitest'
import {
  fetchNativeDeepSeekPage,
  formatNativeWebSearchContext,
  getNativeWebSearchProviderLabel,
  hasNativeWebSearchConfiguration,
  resolveNativeWebSearchApiKey,
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
  it('uses DeepSeek bearer authentication and maps ranked results', async () => {
    const fetchFn = mockFetchResponse({
      results: [
        { title: 'Docs', url: 'https://example.com', summary: 'Detailed summary', snippet: 'Short' },
        { title: 'News', url: 'https://example.com/news', snippet: 'News summary' },
      ],
    })
    const signal = new AbortController().signal
    expect(await searchNativeWeb('Chatbox', { provider: 'deepseek', apiKey: ' shared-key ', fetchFn, signal })).toEqual(
      [
        { title: 'Docs', link: 'https://example.com', snippet: 'Detailed summary' },
        { title: 'News', link: 'https://example.com/news', snippet: 'News summary' },
      ]
    )
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/tools/search',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer shared-key' },
        body: JSON.stringify({ query: 'Chatbox', count: 8 }),
        signal,
      })
    )
  })

  it('trims DeepSeek queries and truncates them to 128 characters', async () => {
    const fetchFn = mockFetchResponse({ results: [] })
    await searchNativeWeb('  Chatbox  ', { provider: 'deepseek', apiKey: 'key', fetchFn })
    await searchNativeWeb(` ${'搜'.repeat(100)}${'😀'.repeat(40)} `, { provider: 'deepseek', apiKey: 'key', fetchFn })
    const bodies = vi.mocked(fetchFn).mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { query: string })
    expect(bodies[0]?.query).toBe('Chatbox')
    expect(bodies[1]?.query).toBe(`${'搜'.repeat(100)}${'😀'.repeat(28)}`)
  })

  it('rejects missing DeepSeek credentials and empty queries before requesting', async () => {
    const fetchFn = mockFetchResponse({ results: [] })
    await expect(searchNativeWeb('  ', { provider: 'deepseek', apiKey: 'key', fetchFn })).rejects.toThrow('empty')
    await expect(searchNativeWeb('query', { provider: 'deepseek', fetchFn })).rejects.toThrow('API key')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(hasNativeWebSearchConfiguration({ provider: 'deepseek', apiKey: ' ' })).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'deepseek', apiKey: 'key' })).toBe(true)
  })

  it('preserves empty DeepSeek results and reports HTTP and payload errors', async () => {
    expect(
      await searchNativeWeb('query', {
        provider: 'deepseek',
        apiKey: 'key',
        fetchFn: mockFetchResponse({ results: [] }),
      })
    ).toEqual([])
    await expect(
      searchNativeWeb('query', { provider: 'deepseek', apiKey: 'key', fetchFn: mockFetchResponse({}, false, 401) })
    ).rejects.toThrow('DeepSeek search failed with status 401')
    await expect(
      searchNativeWeb('query', {
        provider: 'deepseek',
        apiKey: 'key',
        fetchFn: mockFetchResponse({ error: { message: 'Authentication Fails' } }, false, 401),
      })
    ).rejects.toThrow('DeepSeek search failed with status 401: Authentication Fails')
    await expect(
      searchNativeWeb('query', { provider: 'deepseek', apiKey: 'key', fetchFn: mockFetchResponse({}) })
    ).rejects.toThrow('invalid search response')
  })

  it('resolves each provider API key from its settings source', () => {
    const sources = {
      extension: { webSearch: { tavilyApiKey: 'tavily-key', bochaApiKey: 'bocha-key', queritApiKey: 'querit-key' } },
      providers: { deepseek: { apiKey: 'deepseek-model-key' } },
    }
    expect(resolveNativeWebSearchApiKey(sources, 'deepseek')).toBe('deepseek-model-key')
    expect(resolveNativeWebSearchApiKey(sources, 'tavily')).toBe('tavily-key')
    expect(resolveNativeWebSearchApiKey(sources, 'bocha')).toBe('bocha-key')
    expect(resolveNativeWebSearchApiKey(sources, 'querit')).toBe('querit-key')
    expect(resolveNativeWebSearchApiKey(sources, 'bing')).toBe('')
    expect(resolveNativeWebSearchApiKey({ extension: { webSearch: {} } }, 'deepseek')).toBe('')
  })

  it('labels providers by display name', () => {
    expect(getNativeWebSearchProviderLabel('deepseek')).toBe('DeepSeek')
    expect(getNativeWebSearchProviderLabel('bocha')).toBe('BoCha')
  })

  it('detects configuration presence per provider', () => {
    expect(hasNativeWebSearchConfiguration({ provider: 'tavily', apiKey: '' })).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'tavily', apiKey: '  ' })).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'tavily', apiKey: 'tvly-key' })).toBe(true)
    expect(hasNativeWebSearchConfiguration({ provider: 'bing', apiKey: '' })).toBe(true)
    expect(hasNativeWebSearchConfiguration({ provider: 'build-in', apiKey: '' })).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'build-in', apiKey: '' }, 'license-1')).toBe(true)
    expect(hasNativeWebSearchConfiguration({ provider: 'searxng', apiKey: '', apiHost: '' })).toBe(false)
    expect(hasNativeWebSearchConfiguration({ provider: 'searxng', apiKey: '', apiHost: 'https://search.test' })).toBe(
      true
    )
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

  it('searches a SearXNG JSON endpoint with the configured instance URL', async () => {
    const fetchFn = mockFetchResponse({
      results: [
        { title: 'One', url: 'https://one.test', content: 'first snippet' },
        { title: '', url: 'https://invalid.test', content: 'ignored' },
      ],
    })
    const items = await searchNativeWeb('chatbox mobile', {
      provider: 'searxng',
      apiHost: 'https://search.test/',
      fetchFn,
    })

    expect(items).toEqual([{ title: 'One', link: 'https://one.test', snippet: 'first snippet' }])
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://search.test/search?q=chatbox%20mobile&format=json')
    expect((init as RequestInit).headers).toEqual({ Accept: 'application/json' })
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

describe('DeepSeek fetch', () => {
  it('posts the URL with DeepSeek bearer authentication and maps the page', async () => {
    const fetchFn = mockFetchResponse({ title: 'Example article', content: '# Example article\n\nBody' })
    const signal = new AbortController().signal

    await expect(
      fetchNativeDeepSeekPage(' https://example.com/article ', { apiKey: ' shared-key ', fetchFn, signal })
    ).resolves.toEqual({
      url: 'https://example.com/article',
      title: 'Example article',
      content: '# Example article\n\nBody',
    })
    expect(fetchFn).toHaveBeenCalledWith('https://api.deepseek.com/v1/tools/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer shared-key' },
      body: JSON.stringify({ url: 'https://example.com/article' }),
      signal,
    })
  })

  it('uses the hostname when the page has no title', async () => {
    const fetchFn = mockFetchResponse({ title: '', content: 'Body' })
    await expect(fetchNativeDeepSeekPage('https://docs.example.com/a', { apiKey: 'key', fetchFn })).resolves.toEqual({
      url: 'https://docs.example.com/a',
      title: 'docs.example.com',
      content: 'Body',
    })
  })

  it.each([
    ['a non-URL', 'not a url'],
    ['a non-HTTP scheme', 'ftp://example.com/file'],
    ['a URL with a username and password', 'https://user:pass@example.com/'],
    ['a URL with a username', 'https://user@example.com/'],
    ['a file URL', 'file:///etc/hosts'],
    ['a URL over 8192 characters', `https://example.com/${'a'.repeat(8192)}`],
  ])('rejects %s before requesting', async (_label, url) => {
    const fetchFn = mockFetchResponse({ title: 't', content: 'c' })
    await expect(fetchNativeDeepSeekPage(url, { apiKey: 'key', fetchFn })).rejects.toThrow(
      'DeepSeek fetch only accepts'
    )
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('requires the API key before requesting', async () => {
    const fetchFn = mockFetchResponse({ title: 't', content: 'c' })
    await expect(fetchNativeDeepSeekPage('https://example.com', { apiKey: ' ', fetchFn })).rejects.toThrow('API key')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('reports HTTP failures, error bodies and missing content', async () => {
    await expect(
      fetchNativeDeepSeekPage('https://example.com', {
        apiKey: 'key',
        fetchFn: mockFetchResponse({ error: { message: 'Insufficient Balance' } }, false, 402),
      })
    ).rejects.toThrow('DeepSeek fetch failed with status 402: Insufficient Balance')
    // The mobile CapacitorHttp seam reports every response as 200, so the error body decides.
    await expect(
      fetchNativeDeepSeekPage('https://example.com', {
        apiKey: 'key',
        fetchFn: mockFetchResponse({ error: { message: 'Fetch could not retrieve usable page content' } }),
      })
    ).rejects.toThrow('DeepSeek fetch failed: Fetch could not retrieve usable page content')
    await expect(
      fetchNativeDeepSeekPage('https://example.com', { apiKey: 'key', fetchFn: mockFetchResponse({ title: 't' }) })
    ).rejects.toThrow('DeepSeek returned an invalid fetch response')
  })
})
