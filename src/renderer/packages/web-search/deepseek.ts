import { ChatboxAIAPIError } from '@shared/models/errors'
import { fetchNativeDeepSeekPage, searchNativeWeb } from '@shared/services/native-web-search'
import type { SearchResult } from '@shared/types'
import WebSearch, { type ParseLinkResult } from './base'

/** Describes a failed request, including the status and DeepSeek message the desktop/web request layer attaches. */
function describeFetchError(error: unknown): string {
  const failure = error as { message?: unknown; status?: unknown; data?: { error?: { message?: unknown } } }
  const parts = [typeof failure?.message === 'string' ? failure.message : String(error)]
  if (typeof failure?.status === 'number' && !parts[0].includes(String(failure.status))) {
    parts.push(`status ${failure.status}`)
  }
  const detail = failure?.data?.error?.message
  if (typeof detail === 'string' && detail && !parts[0].includes(detail)) parts.push(detail)
  return parts.join(': ')
}

export class DeepSeekSearch extends WebSearch {
  override supportsParseLink = true

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

  async parseLink(url: string, signal?: AbortSignal): Promise<ParseLinkResult> {
    try {
      return await fetchNativeDeepSeekPage(url, { apiKey: this.apiKey, signal, fetchFn: this.fetchCompat })
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
      const technical = `DeepSeek could not read ${url}: ${describeFetchError(error)}`
      throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_failed') ?? new Error(technical)
    }
  }
}
