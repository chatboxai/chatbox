import type { SearchResult } from '@shared/types'
import WebSearch from './base'

type BochaWebPageItem = {
  name: string
  url: string
  summary?: string
  snippet?: string
}

type BochaResponse = {
  code?: number | string
  msg?: string | null
  message?: string | null
  data?: {
    webPages?: {
      value?: BochaWebPageItem[]
    }
  }
  webPages?: {
    value?: BochaWebPageItem[]
  }
}

export class BochaSearch extends WebSearch {
  private apiKey: string
  private readonly endpoints = ['https://api.bocha.cn/v1/web-search', 'https://api.bochaai.com/v1/web-search']

  constructor(apiKey: string) {
    super()
    this.apiKey = apiKey
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      let response: BochaResponse | undefined
      let lastError: unknown

      for (const endpoint of this.endpoints) {
        try {
          const res = (await this.fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: {
              query,
              freshness: 'noLimit',
              summary: true,
              count: 10,
            },
            signal,
          })) as BochaResponse

          const responseCode = Number(res.code)
          if (!Number.isNaN(responseCode) && responseCode !== 200) {
            lastError = new Error(res.msg || res.message || `BoCha API error: ${res.code}`)
            continue
          }

          if ((res.code ?? null) !== null && Number.isNaN(responseCode)) {
            lastError = new Error(res.msg || res.message || `BoCha API error: ${res.code}`)
            continue
          }

          const results = res.data?.webPages?.value ?? res.webPages?.value
          if (!Array.isArray(results)) {
            lastError = new Error('BoCha API malformed payload: webPages.value is not an array')
            continue
          }

          response = res
          break
        } catch (error) {
          lastError = error
        }
      }

      if (!response) {
        throw lastError || new Error('BoCha API request failed on all endpoints')
      }

      // BoCha response payload is nested under `data.webPages.value` in the latest API format.
      // Keep fallback for older payloads that expose `webPages.value` directly.
      const results = response.data?.webPages?.value || response.webPages?.value || []
      const items = results.map((result) => ({
        title: result.name,
        link: result.url,
        snippet: result.summary || result.snippet || '',
      }))

      return { items }
    } catch (error) {
      console.error('BoCha search error:', error)
      throw error
    }
  }
}
