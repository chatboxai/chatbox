import { searchNativeWeb } from '@shared/services/native-web-search'
import type { SearchResult } from '@shared/types'
import WebSearch from './base'

/**
 * Zhipu GLM search: the official Web Search API for results, authenticated with the GLM model
 * provider key. GLM exposes no standalone URL fetch endpoint, so `parse_link` is unavailable.
 */
export class GlmSearch extends WebSearch {
  constructor(private readonly apiKey: string) {
    super()
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    return {
      items: await searchNativeWeb(query, {
        provider: 'glm',
        apiKey: this.apiKey,
        signal,
        fetchFn: this.fetchCompat,
      }),
    }
  }
}
