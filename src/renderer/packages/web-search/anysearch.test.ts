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
        result: {
          content: [
            {
              type: 'text',
              text: '## Search Results (1 result)\n\n### 1. Mobile result\n- **URL**: https://mobile.test\n- Native HTTP.',
            },
          ],
        },
      },
    })

    await expect(new AnysearchSearch('mobile-key', 4).search('mobile query')).resolves.toEqual({
      items: [{ title: 'Mobile result', link: 'https://mobile.test', snippet: 'Native HTTP.' }],
    })
    expect(capacitorRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.anysearch.com/mcp',
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer mobile-key',
          'content-type': 'application/json',
          'x-anysearch-client': 'chatbox/1.0',
          'User-Agent': expect.stringContaining('Android'),
        }),
        data: expect.objectContaining({
          jsonrpc: '2.0',
          params: { name: 'search', arguments: { query: 'mobile query', max_results: 4 } },
        }),
      })
    )
  })

  it('uses the Anysearch extract tool for parseLink', async () => {
    capacitorRequestMock.mockResolvedValue({
      data: { result: { content: [{ type: 'text', text: '# Extracted\nPage body.' }] } },
    })

    await expect(new AnysearchSearch('mobile-key').parseLink('https://docs.example.com/page')).resolves.toEqual({
      url: 'https://docs.example.com/page',
      title: 'docs.example.com',
      content: '# Extracted\nPage body.',
    })
    expect(capacitorRequestMock.mock.calls[0][0].data.params).toEqual({
      name: 'extract',
      arguments: { url: 'https://docs.example.com/page' },
    })
  })

  it('uses the extract envelope title and content for parseLink', async () => {
    capacitorRequestMock.mockResolvedValue({
      data: {
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ url: 'https://docs.example.com/page', title: 'Docs Page', content: 'Body text' }),
            },
          ],
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
          result: {
            content: [
              {
                type: 'text',
                text: '## Search Results (1 result)\n\n### 1. After quota\n- **URL**: https://quota.test\n- Retried.',
              },
            ],
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
