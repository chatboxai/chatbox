import { ChatboxAIAPIError } from '@shared/models/errors'
import { OUTCRAWL_API_URL, searchNativeWeb } from '@shared/services/native-web-search'
import type { SearchResult } from '@shared/types'
import { ofetch } from 'ofetch'
import WebSearch, { type ParseLinkResult } from './base'

export class OutcrawlSearch extends WebSearch {
  private apiKey: string

  override supportsParseLink = true

  constructor(apiKey: string) {
    super()
    this.apiKey = apiKey
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      // Shared implementation, also used by the native mobile shell.
      const items = await searchNativeWeb(query, { provider: 'outcrawl', apiKey: this.apiKey, signal })
      return { items }
    } catch (error) {
      console.error('Outcrawl search error:', error)
      throw error
    }
  }

  async parseLink(url: string, signal?: AbortSignal): Promise<ParseLinkResult> {
    const response = await ofetch(`${OUTCRAWL_API_URL}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: {
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      },
      signal,
    })

    const markdown = typeof response?.markdown === 'string' ? response.markdown.trim() : ''
    if (!markdown) {
      const technical = `Outcrawl scrape API returned no content for ${url}`
      throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_failed') ?? new Error(technical)
    }

    // Prefer the page title from the scrape metadata; fall back to the URL hostname so
    // consumers always get a non-empty label.
    const resultUrl = typeof response.url === 'string' && response.url.trim() ? response.url : url
    const metadataTitle = typeof response.metadata?.title === 'string' ? response.metadata.title.trim() : ''
    let title = metadataTitle || resultUrl
    if (!metadataTitle) {
      try {
        const hostname = new URL(resultUrl).hostname
        if (hostname) title = hostname
      } catch {}
    }

    return { url: resultUrl, title, content: markdown }
  }
}
