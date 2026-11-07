import { searchNativeWeb } from '@shared/services/native-web-search'
import type { SearchResult } from '@shared/types'
import WebSearch from './base'

// Thin shell over the shared SpecStream implementation (native-web-search.ts):
// endpoint fallback and payload handling live there; this class plugs the
// renderer's fetch (CapacitorHttp on mobile for CORS bypass) into it.
export class SpecStreamSearch extends WebSearch {
  private apiKey: string

  constructor(apiKey: string) {
    super()
    this.apiKey = apiKey
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    try {
      const items = await searchNativeWeb(query, {
        provider: 'specstream',
        apiKey: this.apiKey,
        signal,
        fetchFn: this.fetchCompat,
      })
      return { items }
    } catch (error) {
      console.error('SpecStream search error:', error)
      throw error
    }
  }
}
