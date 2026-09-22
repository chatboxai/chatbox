import {
  type AnysearchDomain,
  AnysearchQuotaExhaustedError,
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

  /**
   * Anonymous callers that exhaust the daily free quota get generated
   * credentials in the error; per the Anysearch docs the request should then be
   * resubmitted with that key. It is kept in memory for this call only: nothing
   * is persisted, and the credential never appears in an error or a log.
   */
  private async request<T>(run: (apiKey?: string) => Promise<T>): Promise<T> {
    try {
      return await run(this.apiKey)
    } catch (error) {
      if (!(error instanceof AnysearchQuotaExhaustedError) || !error.credential) throw error
      return run(error.credential.apiKey)
    }
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const markdown = await this.request((apiKey) =>
      searchAnysearch({ query, max_results: this.maxResults }, { apiKey, signal, fetchFn: this.fetchCompat })
    )
    return { items: parseAnysearchSearchResults(markdown) }
  }

  searchAdvanced(request: AnysearchSearchRequest, signal?: AbortSignal): Promise<string> {
    return this.request((apiKey) => searchAnysearch(request, { apiKey, signal, fetchFn: this.fetchCompat }))
  }

  async parseLink(url: string, signal?: AbortSignal): Promise<ParseLinkResult> {
    const extracted = await this.request((apiKey) =>
      extractAnysearch(url, { apiKey, signal, fetchFn: this.fetchCompat })
    )
    let title = extracted.title.trim()
    if (!title) {
      try {
        title = new URL(extracted.url).hostname || extracted.url
      } catch {
        title = extracted.url
      }
    }
    return { url: extracted.url, title, content: extracted.content }
  }

  batchSearch(queries: AnysearchSearchRequest[], signal?: AbortSignal): Promise<string> {
    return this.request((apiKey) => batchSearchAnysearch(queries, { apiKey, signal, fetchFn: this.fetchCompat }))
  }

  getSubDomains(domains: AnysearchDomain[], signal?: AbortSignal): Promise<string> {
    return this.request((apiKey) => getAnysearchSubDomains(domains, { apiKey, signal, fetchFn: this.fetchCompat }))
  }
}
