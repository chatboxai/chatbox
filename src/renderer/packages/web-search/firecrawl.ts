import { ChatboxAIAPIError } from '@shared/models/errors'
import { FIRECRAWL_DEFAULT_HOST, FIRECRAWL_ORIGIN, searchNativeWeb } from '@shared/services/native-web-search'
import type { SearchResult } from '@shared/types'
import { ofetch } from 'ofetch'
import WebSearch, { type ParseLinkResult } from './base'

export class FirecrawlSearch extends WebSearch {
  private apiKey: string

  override supportsParseLink = true

  constructor(apiKey: string) {
    super()
    this.apiKey = apiKey
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      // Shared implementation, also used by the native mobile shell.
      const items = await searchNativeWeb(query, { provider: 'firecrawl', apiKey: this.apiKey, signal })
      return { items }
    } catch (error) {
      console.error('Firecrawl search error:', error)
      throw error
    }
  }

  async parseLink(url: string, signal?: AbortSignal): Promise<ParseLinkResult> {
    const response = await ofetch(`${FIRECRAWL_DEFAULT_HOST}/v2/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: {
        url,
        formats: ['markdown'],
        origin: FIRECRAWL_ORIGIN,
      },
      signal,
    })

    // Failed scrapes (DNS errors, blocked or unreachable pages) come back as `{ success: false, error }`.
    const data = response?.data
    if (!response?.success || typeof data?.markdown !== 'string' || !data.markdown.trim()) {
      const technical = `Firecrawl scrape failed for ${url}: ${response?.error || 'no content returned'}`
      throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_failed') ?? new Error(technical)
    }

    // `metadata.url` is the final URL after redirects, `sourceURL` the one requested.
    const metadataUrl = data.metadata?.url || data.metadata?.sourceURL
    const resultUrl = typeof metadataUrl === 'string' && metadataUrl.trim() ? metadataUrl : url
    let title = typeof data.metadata?.title === 'string' ? data.metadata.title.trim() : ''
    if (!title) {
      // Fall back to the hostname so consumers always get a non-empty label.
      title = resultUrl
      try {
        const hostname = new URL(resultUrl).hostname
        if (hostname) title = hostname
      } catch {}
    }

    return {
      url: resultUrl,
      title,
      content: data.markdown,
    }
  }
}
