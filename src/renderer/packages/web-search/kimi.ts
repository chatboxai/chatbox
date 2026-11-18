import { ChatboxAIAPIError } from '@shared/models/errors'
import { fetchNativeKimiPage, searchNativeWeb } from '@shared/services/native-web-search'
import type { SearchResult } from '@shared/types'
import WebSearch, { type ParseLinkResult } from './base'

/** Describes a failed request, including the status the request layer attaches. */
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

/**
 * Kimi (Moonshot) search: Web Search Basic for results and URL Fetch for `parse_link`.
 * Both authenticate with the Moonshot model provider key (`apiHost` picks the .ai/.cn endpoint).
 */
export class KimiSearch extends WebSearch {
  override supportsParseLink = true

  constructor(
    private readonly apiKey: string,
    private readonly apiHost?: string
  ) {
    super()
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    return {
      items: await searchNativeWeb(query, {
        provider: 'kimi',
        apiKey: this.apiKey,
        apiHost: this.apiHost,
        signal,
        fetchFn: this.fetchCompat,
      }),
    }
  }

  async parseLink(url: string, signal?: AbortSignal): Promise<ParseLinkResult> {
    try {
      return await fetchNativeKimiPage(url, {
        apiKey: this.apiKey,
        apiHost: this.apiHost,
        signal,
        fetchFn: this.fetchCompat,
      })
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
      const technical = `Kimi could not read ${url}: ${describeFetchError(error)}`
      throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_failed') ?? new Error(technical)
    }
  }
}
