import { describe, expect, it, vi } from 'vitest'
import {
  ANYSEARCH_EXTRACT_ENDPOINT,
  ANYSEARCH_SEARCH_ENDPOINT,
  ANYSEARCH_SUB_DOMAINS_ENDPOINT,
  AnysearchQuotaExhaustedError,
  batchSearchAnysearch,
  callAnysearchTool,
  extractAnysearch,
  getAnysearchSubDomains,
  parseAnysearchExtractResult,
  parseAnysearchSearchResults,
  searchAnysearch,
} from './anysearch'

function response(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch
}

const successfulSearchPayload = {
  code: 0,
  message: 'success',
  data: { results: [], metadata: { total_results: 0, search_time_ms: 1 } },
}

describe('Anysearch REST client', () => {
  it('sends the REST search body and BYOK authorization', async () => {
    const fetchFn = response(successfulSearchPayload)
    await expect(
      searchAnysearch(
        { query: ' Chatbox ', max_results: 99 },
        { apiKey: 'key-1', fetchFn, zone: 'intl', language: 'zh-CN' }
      )
    ).resolves.toBe(JSON.stringify(successfulSearchPayload))
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(ANYSEARCH_SEARCH_ENDPOINT)
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer key-1' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      query: 'Chatbox',
      max_results: 10,
      format: 'json',
      zone: 'intl',
      language: 'zh-CN',
    })
  })

  it('omits the authorization header for anonymous REST requests', async () => {
    const fetchFn = response(successfulSearchPayload)
    await expect(searchAnysearch({ query: 'Chatbox' }, { fetchFn })).resolves.toBe(
      JSON.stringify(successfulSearchPayload)
    )
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization')
  })

  it('uses REST extraction without an Authorization header when anonymous', async () => {
    const fetchFn = response({ code: 0, message: 'success', data: { url: 'https://example.com', title: '', content: '' } })
    await callAnysearchTool('extract', { url: 'https://example.com' }, { fetchFn })
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(ANYSEARCH_EXTRACT_ENDPOINT)
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ url: 'https://example.com' })
  })

  it('uses repeated domain query parameters for sub-domain discovery', async () => {
    const fetchFn = response({ code: 0, message: 'success', data: { domains: [] } })
    await getAnysearchSubDomains(['code', 'finance'], { apiKey: 'key-1', fetchFn })
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toBe(`${ANYSEARCH_SUB_DOMAINS_ENDPOINT}?domain=code&domain=finance`)
    expect((init as RequestInit).method).toBe('GET')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer key-1' })
  })

  it('maps vertical search fields to the REST tag and params', async () => {
    const fetchFn = response(successfulSearchPayload)
    await searchAnysearch(
      {
        query: 'quote',
        domain: 'finance',
        sub_domain: 'finance.quote',
        sub_domain_params: { ticker: 'AAPL' },
      },
      { fetchFn }
    )
    const init = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toMatchObject({ tag: 'finance.quote', params: { ticker: 'AAPL' } })
  })

  it('fans batch search out into at most five REST requests', async () => {
    const fetchFn = vi.fn(async (_input: unknown, init: RequestInit) => {
      const query = (JSON.parse(init.body as string) as { query: string }).query
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          message: 'success',
          data: { results: [{ title: query, url: `https://${query}.test`, snippet: query }] },
        }),
      }
    }) as unknown as typeof fetch

    const result = await batchSearchAnysearch([{ query: 'one' }, { query: 'two' }], { fetchFn })
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
    expect(JSON.parse(result).data.queries).toEqual([
      expect.objectContaining({ query: 'one' }),
      expect.objectContaining({ query: 'two' }),
    ])
  })

  it('surfaces REST errors and malformed response errors', async () => {
    await expect(
      callAnysearchTool(
        'search',
        { query: 'q' },
        { fetchFn: response({ code: -1, message: 'rate limited' }, false, 429) }
      )
    ).rejects.toThrow('rate limited')
    await expect(
      callAnysearchTool('search', { query: 'q' }, { fetchFn: response({ code: -1, message: 'bad args' }) })
    ).rejects.toThrow('bad args')
    await expect(callAnysearchTool('search', { query: 'q' }, { fetchFn: response(null) })).rejects.toThrow(
      'without JSON content'
    )
  })

  it('reports anonymous quota exhaustion without leaking the generated credentials', async () => {
    const generated = [
      'Your account and API key have been automatically generated. Use the API key below to continue.',
      'username=auto-user',
      'password=auto-pass',
      'api_key=auto-key',
    ].join('\n')

    const error = await callAnysearchTool(
      'search',
      { query: 'Chatbox' },
      { fetchFn: response({ code: -1, message: generated, request_id: 'req-1' }, false, 402) }
    ).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(AnysearchQuotaExhaustedError)
    expect((error as AnysearchQuotaExhaustedError).credential).toEqual({ apiKey: 'auto-key' })
    expect((error as Error).message).toContain('automatically generated')
    expect((error as Error).message).not.toContain('auto-key')
    expect((error as Error).message).not.toContain('auto-pass')
  })

  it('retries an anonymous quota response while credentials are still being provisioned', async () => {
    vi.useFakeTimers()
    try {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 402,
          json: async () => ({
            code: -1,
            message: 'Anonymous quota registration is still running; retry after a short delay.',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => successfulSearchPayload,
        }) as unknown as typeof fetch

      const resultPromise = callAnysearchTool('search', { query: 'Chatbox' }, { fetchFn })
      await vi.runAllTimersAsync()

      await expect(resultPromise).resolves.toBe(JSON.stringify(successfulSearchPayload))
      expect(fetchFn).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('validates batch, domain discovery, and extract inputs', async () => {
    await expect(batchSearchAnysearch([])).rejects.toThrow('between 1 and 5')
    await expect(getAnysearchSubDomains([])).rejects.toThrow('between 1 and 5')
    await expect(extractAnysearch('file:///tmp/a')).rejects.toThrow('HTTP or HTTPS')
  })

  it('unwraps the REST extract envelope into url, title, and content', async () => {
    const fetchFn = response({
      code: 0,
      message: 'success',
      data: { url: 'https://example.com/a', title: 'Example Article', content: '# Body' },
    })

    await expect(extractAnysearch('https://example.com/a', { fetchFn })).resolves.toEqual({
      url: 'https://example.com/a',
      title: 'Example Article',
      content: '# Body',
    })
  })

  it('supports the legacy plain extract payload parser as a compatibility fallback', () => {
    expect(parseAnysearchExtractResult('# Raw\nBody', 'https://example.com/b')).toEqual({
      url: 'https://example.com/b',
      title: '',
      content: '# Raw\nBody',
    })
  })

  it('rejects incomplete vertical search routing', async () => {
    await expect(searchAnysearch({ query: 'quote', domain: 'finance' })).rejects.toThrow('requires a sub_domain')
    await expect(searchAnysearch({ query: 'quote', sub_domain: 'finance.quote' })).rejects.toThrow('require a domain')
    await expect(
      searchAnysearch({ query: 'snippet', domain: 'finance', sub_domain: 'code.snippet' })
    ).rejects.toThrow('must belong to the requested domain')
  })
})

describe('parseAnysearchSearchResults', () => {
  it('parses the REST search envelope', () => {
    expect(
      parseAnysearchSearchResults(
        JSON.stringify({
          code: 0,
          data: {
            results: [
              { title: 'First result', url: 'https://one.test/page', snippet: 'First snippet.' },
              { title: 'Second result', url: 'https://two.test', content: 'Second content.' },
            ],
          },
        })
      )
    ).toEqual([
      { title: 'First result', link: 'https://one.test/page', snippet: 'First snippet.' },
      { title: 'Second result', link: 'https://two.test', snippet: 'Second content.' },
    ])
  })

  it('keeps parsing the documented search Markdown format', () => {
    const markdown = `## Search Results (2 results)

### 1. First result
- **URL**: https://one.test/page
- First snippet line.

### 2. Second result
- **URL**: https://two.test
- Second snippet.`
    expect(parseAnysearchSearchResults(markdown)).toEqual([
      { title: 'First result', link: 'https://one.test/page', snippet: 'First snippet line.' },
      { title: 'Second result', link: 'https://two.test', snippet: 'Second snippet.' },
    ])
  })

  it('accepts explicit zero-result responses and rejects unknown formats', () => {
    expect(parseAnysearchSearchResults(JSON.stringify({ code: 0, data: { results: [] } }))).toEqual([])
    expect(parseAnysearchSearchResults('## Search Results (0 results)')).toEqual([])
    expect(() => parseAnysearchSearchResults('unexpected payload')).toThrow('unrecognized search result format')
  })
})
