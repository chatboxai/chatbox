import { ChatboxAIAPIError } from '@shared/models/errors'
import { KEENABLE_DEFAULT_HOST, keenableHeaders, searchNativeWeb } from '@shared/services/native-web-search'
import type { SearchResult } from '@shared/types'
import WebSearch, { type ParseLinkResult } from './base'

// Thin shell over the shared Keenable implementation (native-web-search.ts).
// Keenable needs no API key: the search and fetch endpoints have public
// variants, and a key only raises the rate limit.
export class KeenableSearch extends WebSearch {
  private apiKey: string

  override supportsParseLink = true

  constructor(apiKey = '') {
    super()
    this.apiKey = apiKey
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      const items = await searchNativeWeb(query, {
        provider: 'keenable',
        apiKey: this.apiKey,
        signal,
        fetchFn: this.fetchCompat,
      })
      return { items }
    } catch (error) {
      console.error('Keenable search error:', error)
      throw error
    }
  }

  async parseLink(url: string, signal?: AbortSignal): Promise<ParseLinkResult> {
    const apiKey = this.apiKey.trim()
    const response = (await this.fetch(`${KEENABLE_DEFAULT_HOST}${apiKey ? '/v1/fetch' : '/v1/fetch/public'}`, {
      method: 'GET',
      headers: keenableHeaders(apiKey),
      query: { url },
      responseType: 'json',
      signal,
    })) as { url?: string; title?: string; content?: string } | undefined

    const content = response?.content ?? ''
    if (!content) {
      const technical = `Keenable fetch API returned no content for ${url}`
      throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_failed') ?? new Error(technical)
    }

    const resultUrl = response?.url?.trim() || url
    return {
      url: resultUrl,
      title: response?.title?.trim() || resultUrl,
      content,
    }
  }
}
