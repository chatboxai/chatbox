import { describe, expect, it, vi } from 'vitest'
import { BochaSearch } from './bocha'

describe('BochaSearch', () => {
  it('falls back to secondary endpoint when primary returns invalid business code', async () => {
    const search = new BochaSearch('test-api-key')
    const fetchSpy = vi
      .spyOn(search, 'fetch')
      .mockResolvedValueOnce({
        code: 'ERR_UNKNOWN',
        msg: 'primary endpoint failed',
      } as never)
      .mockResolvedValueOnce({
        code: 200,
        data: {
          webPages: {
            value: [{ name: 'result title', url: 'https://example.com', snippet: 'result snippet' }],
          },
        },
      } as never)

    const result = await search.search('test query')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.bocha.cn/v1/web-search')
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('https://api.bochaai.com/v1/web-search')
    expect(result.items).toEqual([
      {
        title: 'result title',
        link: 'https://example.com',
        snippet: 'result snippet',
      },
    ])
  })

  it('falls back to secondary endpoint when primary returns numeric business error code', async () => {
    const search = new BochaSearch('test-api-key')
    const fetchSpy = vi
      .spyOn(search, 'fetch')
      .mockResolvedValueOnce({
        code: 400,
        msg: 'missing parameter query',
      } as never)
      .mockResolvedValueOnce({
        code: 200,
        data: {
          webPages: {
            value: [{ name: 'fallback title', url: 'https://fallback.example.com', snippet: 'fallback snippet' }],
          },
        },
      } as never)

    const result = await search.search('test query')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.bocha.cn/v1/web-search')
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('https://api.bochaai.com/v1/web-search')
    expect(result.items).toEqual([
      {
        title: 'fallback title',
        link: 'https://fallback.example.com',
        snippet: 'fallback snippet',
      },
    ])
  })

  it('falls back to secondary endpoint when primary payload misses webPages.value', async () => {
    const search = new BochaSearch('test-api-key')
    const fetchSpy = vi
      .spyOn(search, 'fetch')
      .mockResolvedValueOnce({
        code: 200,
        data: {},
      } as never)
      .mockResolvedValueOnce({
        code: 200,
        data: {
          webPages: {
            value: [{ name: 'valid title', url: 'https://valid.example.com', summary: 'valid summary' }],
          },
        },
      } as never)

    const result = await search.search('test query')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.bocha.cn/v1/web-search')
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('https://api.bochaai.com/v1/web-search')
    expect(result.items).toEqual([
      {
        title: 'valid title',
        link: 'https://valid.example.com',
        snippet: 'valid summary',
      },
    ])
  })
})
