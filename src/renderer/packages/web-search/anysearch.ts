import {
  type AnysearchDomain,
  type AnysearchSearchRequest,
  batchSearchAnysearch,
  extractAnysearch,
  getAnysearchSubDomains,
  parseAnysearchSearchResults,
  searchAnysearch,
} from '@shared/services/anysearch'
import type { SearchResult } from '@shared/types'
import WebSearch, { type ParseLinkResult } from './base'

export class AnysearchSearch extends WebSearch {
  override supportsParseLink = true

  /**
   * Omitting the API key uses Anysearch's anonymous mode: requests are
   * rate-limited per client IP and metered against the daily free quota.
   */
  constructor(
    private readonly apiKey?: string,
    private readonly maxResults = 10
  ) {
    super()
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const markdown = await searchAnysearch(
      { query, max_results: this.maxResults },
      { apiKey: this.apiKey, signal, fetchFn: this.fetchCompat }
    )
    return { items: parseAnysearchSearchResults(markdown) }
  }

  searchAdvanced(request: AnysearchSearchRequest, signal?: AbortSignal): Promise<string> {
    return searchAnysearch(request, { apiKey: this.apiKey, signal, fetchFn: this.fetchCompat })
  }

  async parseLink(url: string, signal?: AbortSignal): Promise<ParseLinkResult> {
    const content = await extractAnysearch(url, { apiKey: this.apiKey, signal, fetchFn: this.fetchCompat })
    let title = url
    try {
      title = new URL(url).hostname || url
    } catch {}
    return { url, title, content }
  }

  batchSearch(queries: AnysearchSearchRequest[], signal?: AbortSignal): Promise<string> {
    return batchSearchAnysearch(queries, { apiKey: this.apiKey, signal, fetchFn: this.fetchCompat })
  }

  getSubDomains(domains: AnysearchDomain[], signal?: AbortSignal): Promise<string> {
    return getAnysearchSubDomains(domains, { apiKey: this.apiKey, signal, fetchFn: this.fetchCompat })
  }
}
