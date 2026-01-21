import { ofetch } from 'ofetch'
import WebSearch from './base'
import { SearchResult } from 'src/shared/types'

export class QueritSearch extends WebSearch {
  private readonly QUERIT_SEARCH_URL = 'https://api.querit.ai/v1/search'
  private apiKey: string

  constructor(apiKey: string) {
    super()
    this.apiKey = apiKey
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      const requestBody = { query }
      const response = await ofetch(this.QUERIT_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: requestBody,
        signal,
      })

      // Check error code
      if (response.error_code !== 200) {
        console.error('Querit search API error:', response.error_code, response.error)
        return { items: [] }
      }

      // Check if results exist
      if (!response.results || !response.results.result || !Array.isArray(response.results.result)) {
        console.error('Querit search: results not found or not array')
        return { items: [] }
      }

      // Extract result
      const items = response.results.result.map((result: any) => ({
        title: result.title,
        link: result.url,
        snippet: result.snippet,
      }))

      return { items }
    } catch (error) {
      console.error('Querit search error:', error)
      return { items: [] }
    }
  }
}