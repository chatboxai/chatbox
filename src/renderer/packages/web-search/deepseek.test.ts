import { ChatboxAIAPIError } from '@shared/models/errors'
import { describe, expect, it, vi } from 'vitest'
import { DeepSeekSearch } from './deepseek'

describe('DeepSeekSearch.parseLink', () => {
  it('reads the page through the DeepSeek Fetch API', async () => {
    const search = new DeepSeekSearch('shared-key')
    const fetchSpy = vi
      .spyOn(search, 'fetch')
      .mockResolvedValue({ title: 'Example article', content: '# Example article' } as never)

    await expect(search.parseLink('https://example.com/article')).resolves.toEqual({
      url: 'https://example.com/article',
      title: 'Example article',
      content: '# Example article',
    })
    expect(search.supportsParseLink).toBe(true)
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/v1/tools/fetch')
    expect(options).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer shared-key' },
      body: { url: 'https://example.com/article' },
    })
  })

  it('reports HTTP failures as parse_link_failed with the DeepSeek message', async () => {
    const search = new DeepSeekSearch('shared-key')
    vi.spyOn(search, 'fetch').mockRejectedValue(
      Object.assign(new Error('[POST] "https://api.deepseek.com/v1/tools/fetch": 402 Payment Required'), {
        status: 402,
        data: { error: { message: 'Insufficient Balance' } },
      })
    )

    const error = await search.parseLink('https://example.com').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ChatboxAIAPIError)
    expect((error as ChatboxAIAPIError).detail.name).toBe('parse_link_failed')
    expect((error as Error).message).toContain('402')
    expect((error as Error).message).toContain('Insufficient Balance')
  })

  it('rejects credentialed URLs as parse_link_failed without requesting', async () => {
    const search = new DeepSeekSearch('shared-key')
    const fetchSpy = vi.spyOn(search, 'fetch')

    const error = await search.parseLink('https://user:pass@example.com').catch((e: unknown) => e)
    expect((error as ChatboxAIAPIError).detail.name).toBe('parse_link_failed')
    expect((error as Error).message).toContain('DeepSeek fetch only accepts')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps cancellations as abort errors', async () => {
    const search = new DeepSeekSearch('shared-key')
    vi.spyOn(search, 'fetch').mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    await expect(search.parseLink('https://example.com')).rejects.toMatchObject({ name: 'AbortError' })
  })
})
