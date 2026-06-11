import { ChatboxAIAPIError } from '@shared/models/errors'
import type { SearchResult } from '@shared/types'
import WebSearch, { type ParseLinkResult } from './base'

export class KagiSearch extends WebSearch {
  private apiKey: string

  override supportsParseLink = true

  constructor(apiKey: string) {
    super()
    this.apiKey = apiKey
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      const response = await this.fetch('https://kagi.com/api/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: {
          query,
        },
        signal,
      })

      const items = (response.data?.search || []).map((result: { url: string; title: string; snippet?: string }) => ({
        title: result.title,
        link: result.url,
        snippet: result.snippet || '',
      }))

      return { items }
    } catch (error) {
      console.error('Kagi search error:', error)
      throw error
    }
  }

  async parseLink(url: string, signal?: AbortSignal): Promise<ParseLinkResult> {
    const response = await this.fetch('https://kagi.com/api/v1/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: {
        pages: [{ url }],
      },
      signal,
    })

    const result = response.data?.[0]
    if (!result || result.error) {
      const technical = result?.error || `Kagi extract API returned no results for ${url}`
      throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_failed') ?? new Error(technical)
    }

    let title = url
    try {
      const hostname = new URL(url).hostname
      if (hostname) title = hostname
    } catch {}

    return {
      url,
      title,
      content: result.markdown || '',
    }
  }
}