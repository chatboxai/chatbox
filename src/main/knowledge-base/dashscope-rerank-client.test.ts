import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DashScopeRerankClient,
  buildRerankRequest,
  isDashScopeHost,
  parseRerankResponse,
  toDashScopeOrigin,
  usesCompatibleRerankApi,
} from './dashscope-rerank-client'

const HOST = 'https://ws-demo.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
const ORIGIN = 'https://ws-demo.cn-beijing.maas.aliyuncs.com'

function mockFetch(payload: unknown, status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DashScope host helpers', () => {
  it('detects Alibaba Cloud hosts but not other providers', () => {
    expect(isDashScopeHost(HOST)).toBe(true)
    expect(isDashScopeHost('https://dashscope.aliyuncs.com')).toBe(true)
    expect(isDashScopeHost('https://api.siliconflow.cn/v1')).toBe(false)
    expect(isDashScopeHost(undefined)).toBe(false)
  })

  it('strips API path suffixes from the host', () => {
    expect(toDashScopeOrigin(HOST)).toBe(ORIGIN)
    expect(toDashScopeOrigin('https://dashscope.aliyuncs.com/api/v1')).toBe(
      'https://dashscope.aliyuncs.com'
    )
  })

  it('routes only qwen3-rerank to the compatible protocol', () => {
    expect(usesCompatibleRerankApi('qwen3-rerank')).toBe(true)
    expect(usesCompatibleRerankApi('QWEN3-RERANK')).toBe(true)
    expect(usesCompatibleRerankApi('qwen3.7-text-rerank')).toBe(false)
    expect(usesCompatibleRerankApi('gte-rerank-v2')).toBe(false)
  })
})

describe('buildRerankRequest', () => {
  it('builds the workspace compatible request for qwen3-rerank', () => {
    const { url, body } = buildRerankRequest({
      apiHost: HOST,
      model: 'qwen3-rerank',
      query: 'q',
      documents: ['a', 'b'],
      topN: 2,
    })

    expect(url).toBe(`${ORIGIN}/compatible-api/v1/reranks`)
    expect(body).toEqual({ model: 'qwen3-rerank', query: 'q', documents: ['a', 'b'], top_n: 2 })
  })

  it('builds the native request for qwen3.7-text-rerank', () => {
    const { url, body } = buildRerankRequest({
      apiHost: HOST,
      model: 'qwen3.7-text-rerank',
      query: 'q',
      documents: ['a', 'b'],
      topN: 2,
    })

    expect(url).toBe(`${ORIGIN}/api/v1/services/rerank/text-rerank/text-rerank`)
    expect(body).toEqual({
      model: 'qwen3.7-text-rerank',
      input: { query: 'q', documents: ['a', 'b'] },
      parameters: { top_n: 2, return_documents: false },
    })
  })

  it('clamps top_n to the document count', () => {
    const { body } = buildRerankRequest({
      apiHost: HOST,
      model: 'qwen3-rerank',
      query: 'q',
      documents: ['a'],
      topN: 5,
    })

    expect((body as { top_n: number }).top_n).toBe(1)
  })
})

describe('parseRerankResponse', () => {
  it('parses the compatible response (top-level results)', () => {
    expect(
      parseRerankResponse({
        object: 'list',
        results: [
          { index: 0, relevance_score: 0.93 },
          { index: 2, relevance_score: 0.34 },
        ],
      })
    ).toEqual([
      { index: 0, relevanceScore: 0.93 },
      { index: 2, relevanceScore: 0.34 },
    ])
  })

  it('parses the native response (output.results)', () => {
    expect(
      parseRerankResponse({ output: { results: [{ index: 1, relevance_score: 0.5 }] } })
    ).toEqual([{ index: 1, relevanceScore: 0.5 }])
  })

  it('returns an empty list for unknown payload shapes', () => {
    expect(parseRerankResponse({ foo: 'bar' })).toEqual([])
    expect(parseRerankResponse(null)).toEqual([])
  })
})

describe('DashScopeRerankClient.rerank', () => {
  it('calls the compatible endpoint and maps the response for qwen3-rerank', async () => {
    const fetchMock = mockFetch({ object: 'list', results: [{ index: 0, relevance_score: 0.93 }] })
    const client = new DashScopeRerankClient({ apiHost: HOST, token: 'sk-test' })

    const result = await client.rerank({
      query: 'q',
      documents: ['a', 'b'],
      model: 'qwen3-rerank',
      topN: 2,
    })

    expect(result.results).toEqual([{ index: 0, relevanceScore: 0.93 }])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${ORIGIN}/compatible-api/v1/reranks`)
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'qwen3-rerank',
      query: 'q',
      documents: ['a', 'b'],
      top_n: 2,
    })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('calls the native endpoint for qwen3.7-text-rerank', async () => {
    const fetchMock = mockFetch({ output: { results: [{ index: 1, relevance_score: 0.5 }] } })
    const client = new DashScopeRerankClient({ apiHost: HOST, token: 'sk-test' })

    const result = await client.rerank({ query: 'q', documents: ['a', 'b'], model: 'qwen3.7-text-rerank' })

    expect(result.results).toEqual([{ index: 1, relevanceScore: 0.5 }])

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${ORIGIN}/api/v1/services/rerank/text-rerank/text-rerank`)
  })

  it('skips the API call when there are no documents', async () => {
    const fetchMock = mockFetch({})
    const client = new DashScopeRerankClient({ apiHost: HOST, token: 'sk-test' })

    await expect(
      client.rerank({ query: 'q', documents: [], model: 'qwen3-rerank' })
    ).resolves.toEqual({ results: [] })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces HTTP failures', async () => {
    mockFetch({ message: 'nope' }, 500)
    const client = new DashScopeRerankClient({ apiHost: HOST, token: 'sk-test' })

    await expect(
      client.rerank({ query: 'q', documents: ['a'], model: 'qwen3-rerank' })
    ).rejects.toThrow(/HTTP 500/)
  })

  it('surfaces DashScope error payloads', async () => {
    mockFetch({ code: 'InvalidApiKey', message: 'bad key' })
    const client = new DashScopeRerankClient({ apiHost: HOST, token: 'sk-test' })

    await expect(
      client.rerank({ query: 'q', documents: ['a'], model: 'qwen3.7-text-rerank' })
    ).rejects.toThrow(/InvalidApiKey/)
  })

  it('throws when a successful response cannot be parsed (avoids silently dropping context)', async () => {
    mockFetch({ object: 'list', results: [] })
    const client = new DashScopeRerankClient({ apiHost: HOST, token: 'sk-test' })

    await expect(
      client.rerank({ query: 'q', documents: ['a'], model: 'qwen3-rerank' })
    ).rejects.toThrow(/no parsable results/)
  })

  it('maps an aborted request to a timeout error', async () => {
    const fetchMock = vi.fn(async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new DashScopeRerankClient({ apiHost: HOST, token: 'sk-test' })

    await expect(
      client.rerank({ query: 'q', documents: ['a'], model: 'qwen3-rerank' })
    ).rejects.toThrow(/timed out/)
  })
})
