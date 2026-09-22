import { describe, expect, it, vi } from 'vitest'
import {
  ANYSEARCH_ENDPOINT,
  AnysearchQuotaExhaustedError,
  batchSearchAnysearch,
  callAnysearchTool,
  extractAnysearch,
  getAnysearchSubDomains,
  parseAnysearchSearchResults,
  searchAnysearch,
} from './anysearch'

function response(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch
}

describe('Anysearch client', () => {
  it('sends the JSON-RPC envelope and BYOK authorization', async () => {
    const fetchFn = response({ result: { content: [{ type: 'text', text: 'result text' }] } })
    await expect(searchAnysearch({ query: ' Chatbox ', max_results: 99 }, { apiKey: 'key-1', fetchFn })).resolves.toBe(
      'result text'
    )
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(ANYSEARCH_ENDPOINT)
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer key-1' })
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'Chatbox', max_results: 10 } },
    })
  })

  it('omits the authorization header for anonymous requests', async () => {
    const fetchFn = response({ result: { content: [{ type: 'text', text: 'anonymous result' }] } })
    await expect(searchAnysearch({ query: 'Chatbox' }, { fetchFn })).resolves.toBe('anonymous result')
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization')
  })

  it('supports anonymous calls without an Authorization header', async () => {
    const fetchFn = response({ result: { content: [{ type: 'text', text: 'ok' }] } })
    await callAnysearchTool('extract', { url: 'https://example.com' }, { fetchFn })
    const init = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('surfaces HTTP, JSON-RPC, and malformed response errors', async () => {
    await expect(
      callAnysearchTool(
        'search',
        { query: 'q' },
        { fetchFn: response({ error: { message: 'rate limited' } }, false, 429) }
      )
    ).rejects.toThrow('rate limited')
    await expect(
      callAnysearchTool('search', { query: 'q' }, { fetchFn: response({ error: { code: -1, message: 'bad args' } }) })
    ).rejects.toThrow('bad args')
    await expect(callAnysearchTool('search', { query: 'q' }, { fetchFn: response({ result: {} }) })).rejects.toThrow(
      'without text content'
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

  it('detects the quota credential even when the caller flattens the HTTP status', async () => {
    const generated = ['username=auto-user', 'password=auto-pass', 'api_key=auto-key'].join('\n')

    await expect(
      callAnysearchTool('search', { query: 'Chatbox' }, { fetchFn: response({ code: -1, message: generated }) })
    ).rejects.toBeInstanceOf(AnysearchQuotaExhaustedError)
  })

  it('validates batch, domain discovery, and extract inputs', async () => {
    await expect(batchSearchAnysearch([])).rejects.toThrow('between 1 and 5')
    await expect(getAnysearchSubDomains([])).rejects.toThrow('between 1 and 5')
    await expect(extractAnysearch('file:///tmp/a')).rejects.toThrow('HTTP or HTTPS')
  })

  it('unwraps the extract envelope into url, title, and content', async () => {
    const fetchFn = response({
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ url: 'https://example.com/a', title: 'Example Article', content: '# Body' }),
          },
        ],
      },
    })

    await expect(extractAnysearch('https://example.com/a', { fetchFn })).resolves.toEqual({
      url: 'https://example.com/a',
      title: 'Example Article',
      content: '# Body',
    })
  })

  it('falls back to plain extract text when the payload is not the JSON envelope', async () => {
    const fetchFn = response({ result: { content: [{ type: 'text', text: '# Raw\nBody' }] } })

    await expect(extractAnysearch('https://example.com/b', { fetchFn })).resolves.toEqual({
      url: 'https://example.com/b',
      title: '',
      content: '# Raw\nBody',
    })
  })

  it('rejects incomplete vertical search routing', async () => {
    await expect(searchAnysearch({ query: 'quote', domain: 'finance' })).rejects.toThrow('requires a sub_domain')
    await expect(searchAnysearch({ query: 'quote', sub_domain: 'finance.quote' })).rejects.toThrow('require a domain')
  })
})

describe('parseAnysearchSearchResults', () => {
  it('parses the documented search Markdown format', () => {
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

  it('accepts an explicit zero-result response and rejects unknown non-empty formats', () => {
    expect(parseAnysearchSearchResults('## Search Results (0 results)')).toEqual([])
    expect(() => parseAnysearchSearchResults('unexpected payload')).toThrow('unrecognized search result format')
  })
})
