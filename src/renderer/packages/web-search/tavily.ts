import { ofetch } from 'ofetch'
import WebSearch from './base'
import { SearchResult } from 'src/shared/types'

export class TavilySearch extends WebSearch {
  private readonly TAVILY_SEARCH_URL = 'https://api.tavily.com/search'

  private apiKey: string
  private searchDepth: string
  private maxResults: number
  private timeRange: string | null
  private includeRawContent: string | null

  constructor(
    apiKey: string,
    searchDepth: string = 'basic',
    maxResults: number = 5,
    timeRange: string | null = null,
    includeRawContent: string | null = null
  ) {
    super()
    this.apiKey = apiKey
    this.searchDepth = searchDepth
    this.maxResults = maxResults
    this.timeRange = timeRange === 'none' ? null : timeRange
    this.includeRawContent = includeRawContent === 'none' ? null : includeRawContent
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      const requestBody = this.buildRequestBody(query)
      const response = await ofetch(this.TAVILY_SEARCH_URL, {
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
        rawContent: result.raw_content,
      }))

      return { items }
    } catch (error) {
      console.error('Tavily search error:', error)
      return { items: [] }
    }
  }

  private buildRequestBody(query: string): any {
    const requestBody: any = {
      query,
      search_depth: this.searchDepth,
      max_results: this.maxResults,
      include_domains: [],
      exclude_domains: [],
    }

    if (!this.isNullOrNone(this.timeRange)) {
      requestBody.time_range = this.timeRange
    }

    if (!this.isNullOrNone(this.includeRawContent)) {
      requestBody.include_raw_content = this.includeRawContent
    }

    return requestBody
  }

  private isNullOrNone(value: string | null): boolean {
    return value === null || value === 'none'
  }
}
