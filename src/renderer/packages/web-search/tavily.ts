import { ofetch } from 'ofetch'
import WebSearch from './base'
import { SearchResult } from 'src/shared/types'

export class TavilySearch extends WebSearch {
  private apiKey: string
  private includeAnswer: string
  private searchDepth: string
  private maxResults: number
  private timeRange: string | null
  private includeRawContent: string | null

  constructor(
    apiKey: string,
    includeAnswer: string = 'none',
    searchDepth: string = 'basic',
    maxResults: number = 5,
    timeRange: string | null = 'none',
    includeRawContent: string | null = 'none'
  ) {
    super()
    this.apiKey = apiKey
    this.includeAnswer = includeAnswer
    this.searchDepth = searchDepth
    this.maxResults = maxResults
    this.timeRange = timeRange === 'none' ? null : timeRange
    this.includeRawContent = includeRawContent === 'none' ? null : includeRawContent
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      const requestBody: any = {
        query,
        search_depth: this.searchDepth,
        max_results: this.maxResults,
        include_domains: [],
        exclude_domains: [],
      }

      if (this.includeAnswer !== 'none') {
        requestBody.include_answer = this.includeAnswer
      }

      if (this.timeRange !== null) {
        requestBody.time_range = this.timeRange
      }

      if (this.includeRawContent !== null) {
        requestBody.include_raw_content = this.includeRawContent
      }

      const response = await ofetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: requestBody,
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
