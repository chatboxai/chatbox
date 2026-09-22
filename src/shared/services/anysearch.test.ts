import { describe, expect, it, vi } from 'vitest'
import {
  ANYSEARCH_ENDPOINT,
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

  it('supports anonymous calls without an Authorization header', async () => {
    const fetchFn = response({ result: { content: [{ type: 'text', text: 'ok' }] } })
    await callAnysearchTool('extract', { url: 'https://example.com' }, { fetchFn })
    const init = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('surfaces HTTP, JSON-RPC, and malformed response errors', async () => {
    await expect(
      callAnysearchTool('search', { query: 'q' }, { fetchFn: response({ error: { message: 'rate limited' } }, false, 429) })
    ).rejects.toThrow('rate limited')
    await expect(
      callAnysearchTool('search', { query: 'q' }, { fetchFn: response({ error: { code: -1, message: 'bad args' } }) })
    ).rejects.toThrow('bad args')
    await expect(callAnysearchTool('search', { query: 'q' }, { fetchFn: response({ result: {} }) })).rejects.toThrow(
      'without text content'
    )
  })

  it('validates batch, domain discovery, and extract inputs', async () => {
    await expect(batchSearchAnysearch([])).rejects.toThrow('between 1 and 5')
    await expect(getAnysearchSubDomains([])).rejects.toThrow('between 1 and 5')
    await expect(extractAnysearch('file:///tmp/a')).rejects.toThrow('HTTP or HTTPS')
  })

  it('rejects incomplete vertical search routing', async () => {
    await expect(searchAnysearch({ query: 'quote', domain: 'finance' })).rejects.toThrow('requires a sub_domain')
    await expect(searchAnysearch({ query: 'quote', sub_domain: 'finance.quote' })).rejects.toThrow(
      'require a domain'
    )
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
