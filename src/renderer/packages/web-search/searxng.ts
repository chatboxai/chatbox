import type { SearchResult } from '@shared/types'
import WebSearch from './base'

type SearxngResult = {
  title?: unknown
  url?: unknown
  content?: unknown
  snippet?: unknown
}

type SearxngResponse = {
  results: unknown[]
}

export function normalizeSearxngBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '')
}

function toNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isSearxngResult(value: unknown): value is SearxngResult {
  return typeof value === 'object' && value !== null
}

function isSearxngResponse(value: unknown): value is SearxngResponse {
  if (typeof value !== 'object' || value === null || !('results' in value)) {
    return false
  }
  return Array.isArray(value.results)
}

export class SearxngSearch extends WebSearch {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    super()
    this.baseUrl = normalizeSearxngBaseUrl(baseUrl)
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      const response = await this.fetch(`${this.baseUrl}/search`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        query: {
          q: query,
          format: 'json',
        },
        responseType: 'json',
        signal,
      })

      if (!isSearxngResponse(response)) {
        throw new Error('SearXNG returned an invalid JSON search response')
      }

      const results = response.results
      const items = results
        .filter(isSearxngResult)
        .map((result) => {
          const title = toNonEmptyString(result.title)
          const link = toNonEmptyString(result.url)
          if (!title || !link) return null
          return {
            title,
            link,
            snippet: toNonEmptyString(result.content) ?? toNonEmptyString(result.snippet) ?? '',
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)

      return { items }
    } catch (error) {
      console.error('SearXNG search error:', error)
      throw error
    }
  }
}
