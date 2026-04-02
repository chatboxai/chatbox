import type { SearchResult } from '@shared/types'
import { ofetch } from 'ofetch'
import WebSearch from './base'

export const QUERIT_SEARCH_URL = 'https://api.querit.ai/v1/search'

interface QueritRequestBody {
  query: string
  count: number
  filters?: { timeRange: { date: string } }
}

export class QueritSearch extends WebSearch {
  private apiKey: string
  private maxResults: number
  private timeRange: string | null

  constructor(apiKey: string, maxResults: number = 5, timeRange: string | null = null) {
    super()
    this.apiKey = apiKey
    this.maxResults = maxResults
    this.timeRange = timeRange === 'none' ? null : timeRange
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      const requestBody: QueritRequestBody = { query, count: this.maxResults }
      if (this.timeRange) {
        requestBody.filters = { timeRange: { date: this.timeRange } }
      }

      const response = await ofetch(QUERIT_SEARCH_URL, {
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