import { beforeEach, describe, expect, it, vi } from 'vitest'

const capacitorRequestMock = vi.fn()

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { request: (...args: unknown[]) => capacitorRequestMock(...args) },
}))

vi.mock('@/platform', () => ({ default: { type: 'mobile' } }))
vi.mock('@/variables', () => ({ CHATBOX_BUILD_PLATFORM: 'android' }))

import { AnysearchSearch } from './anysearch'

describe('AnysearchSearch on mobile', () => {
  beforeEach(() => capacitorRequestMock.mockReset())

  it('uses CapacitorHttp for authenticated search', async () => {
    capacitorRequestMock.mockResolvedValue({
      data: {
        code: 0,
        message: 'success',
        data: {
          results: [{ title: 'Mobile result', url: 'https://mobile.test', snippet: 'Native HTTP.' }],
        },
      },
    })

    await expect(
      new AnysearchSearch('mobile-key', 4, undefined, { zone: 'cn', language: 'zh-CN' }).search('mobile query')
    ).resolves.toEqual({
      items: [{ title: 'Mobile result', link: 'https://mobile.test', snippet: 'Native HTTP.' }],
    })
    expect(capacitorRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.anysearch.com/v1/search',
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer mobile-key',
          'content-type': 'application/json',
          'User-Agent': expect.stringContaining('Android'),
        }),
        data: { query: 'mobile query', max_results: 4, format: 'json', zone: 'cn', language: 'zh-CN' },
      })
    )
  })

  it('uses the Anysearch extract tool for parseLink', async () => {
    capacitorRequestMock.mockResolvedValue({
      data: {
        code: 0,
        message: 'success',
        data: { url: 'https://docs.example.com/page', title: '', content: '# Extracted\nPage body.' },
      },
    })

    await expect(new AnysearchSearch('mobile-key').parseLink('https://docs.example.com/page')).resolves.toEqual({
      url: 'https://docs.example.com/page',
      title: 'docs.example.com',
      content: '# Extracted\nPage body.',
    })
    expect(capacitorRequestMock.mock.calls[0][0].url).toBe('https://api.anysearch.com/v1/extract')
    expect(capacitorRequestMock.mock.calls[0][0].data).toEqual({ url: 'https://docs.example.com/page' })
  })

  it('uses the extract envelope title and content for parseLink', async () => {
    capacitorRequestMock.mockResolvedValue({
      data: {
        code: 0,
        message: 'success',
        data: {
          url: 'https://docs.example.com/page',
          title: 'Docs Page',
          content: 'Body text',
        },
      },
    })

    await expect(new AnysearchSearch('mobile-key').parseLink('https://docs.example.com/page')).resolves.toEqual({
      url: 'https://docs.example.com/page',
      title: 'Docs Page',
      content: 'Body text',
    })
  })

  it('retries once with the generated credential when the free quota is exhausted', async () => {
    capacitorRequestMock
      .mockResolvedValueOnce({
        data: {
          code: -1,
          message: ['username=auto-user', 'password=auto-pass', 'api_key=auto-key'].join('\n'),
        },
      })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          message: 'success',
          data: {
            results: [{ title: 'After quota', url: 'https://quota.test', snippet: 'Retried.' }],
          },
        },
      })

    await expect(new AnysearchSearch(undefined, 1).search('quota query')).resolves.toEqual({
      items: [{ title: 'After quota', link: 'https://quota.test', snippet: 'Retried.' }],
    })
    expect(capacitorRequestMock).toHaveBeenCalledTimes(2)
    expect(capacitorRequestMock.mock.calls[0][0].headers).not.toHaveProperty('authorization')
    expect(capacitorRequestMock.mock.calls[1][0].headers).toHaveProperty('authorization', 'Bearer auto-key')
  })
})

describe('AnysearchSearch generated credentials', () => {
  beforeEach(() => capacitorRequestMock.mockReset())

  const quotaExhaustedResponse = {
    data: {
      code: -1,
      message: ['username=auto-user', 'password=auto-pass', 'api_key=auto-key'].join('\n'),
    },
  }
  const searchResultResponse = {
    data: {
      code: 0,
      message: 'success',
      data: {
        results: [{ title: 'After quota', url: 'https://quota.test', snippet: 'Retried.' }],
      },
    },
  }
  const afterQuota = {
    items: [{ title: 'After quota', link: 'https://quota.test', snippet: 'Retried.' }],
  }

  it('hands the generated key to the caller once the retry succeeded', async () => {
    const onApiKeyGenerated = vi.fn()
    capacitorRequestMock.mockResolvedValueOnce(quotaExhaustedResponse).mockResolvedValueOnce(searchResultResponse)

    await expect(new AnysearchSearch(undefined, 1, onApiKeyGenerated).search('quota query')).resolves.toEqual(
      afterQuota
    )
    expect(onApiKeyGenerated).toHaveBeenCalledTimes(1)
    expect(onApiKeyGenerated).toHaveBeenCalledWith('auto-key')
  })

  it('keeps a rejected key away from the caller', async () => {
    const onApiKeyGenerated = vi.fn()
    capacitorRequestMock
      .mockResolvedValueOnce(quotaExhaustedResponse)
      .mockResolvedValueOnce({ data: { code: -1, message: 'quota still exhausted' } })

    await expect(new AnysearchSearch(undefined, 1, onApiKeyGenerated).search('quota query')).rejects.toThrow(
      'quota still exhausted'
    )
    expect(onApiKeyGenerated).not.toHaveBeenCalled()
  })

  it('serves the search when storing the key fails', async () => {
    const onApiKeyGenerated = vi.fn(() => {
      throw new Error('settings are read-only')
    })
    capacitorRequestMock.mockResolvedValueOnce(quotaExhaustedResponse).mockResolvedValueOnce(searchResultResponse)

    await expect(new AnysearchSearch(undefined, 1, onApiKeyGenerated).search('quota query')).resolves.toEqual(
      afterQuota
    )
  })
})
