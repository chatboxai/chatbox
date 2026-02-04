import { ofetch } from 'ofetch'
import WebSearch from './base'
import { SearchResult } from 'src/shared/types'

export class BoChaSearch extends WebSearch {
  private readonly BOCHA_SEARCH_URL = 'https://api.bochaai.com/v1/web-search'

  private apiKey: string

  constructor(
    apiKey: string,
  ) {
    super()
    this.apiKey = apiKey
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      const requestBody = {
        query: query,
      }
      const response = await ofetch(this.BOCHA_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: requestBody,
        signal,
      })
      if (response.code !== 200) {
        console.error('BoCha search API error:', response.code)
        return { items: [] }
      }
      const items = response.data.webPages.value.map((page: any) => ({
        title: page.name,
        link: page.url,
        snippet: page.snippet,
      }))

      return { items }
    } catch (error) {
      console.error('BoCha search error:', error)
      return { items: [] }
    }
  }
}