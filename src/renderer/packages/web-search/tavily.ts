import { ofetch } from 'ofetch'
import WebSearch from './base'
import { SearchResult } from 'src/shared/types'

export class TavilySearch extends WebSearch {
  private apiKey: string

  constructor(apiKey: string) {
    super()
    this.apiKey = apiKey
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      const response = await ofetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: {
          query,
          search_depth: 'basic',
          include_domains: [],
          exclude_domains: [],
        },
        signal,
      })

      const items = (response.results || []).map((result: any) => ({
        title: result.title,
        link: result.url,
        snippet: result.content,
      }))

      return { items }
    } catch (error) {
      console.error('Tavily search error:', error)
      return { items: [] }
    }
  }
}
