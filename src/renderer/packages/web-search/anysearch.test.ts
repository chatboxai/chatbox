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
})
