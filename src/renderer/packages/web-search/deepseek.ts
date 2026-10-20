import { searchNativeWeb } from '@shared/services/native-web-search'
import type { SearchResult } from '@shared/types'
import WebSearch from './base'

export class DeepSeekSearch extends WebSearch {
  constructor(private readonly apiKey: string) {
    super()
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    return {
      items: await searchNativeWeb(query, {
        provider: 'deepseek',
        apiKey: this.apiKey,
        signal,
        fetchFn: this.fetchCompat,
      }),
    }
  }
}
