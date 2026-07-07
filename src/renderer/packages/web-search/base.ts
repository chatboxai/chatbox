import type { SearchResult } from '@shared/types'
import { type FetchOptions, ofetch } from 'ofetch'

export interface ParseLinkResult {
  url: string
  title: string
  content: string
}

abstract class WebSearch {
  abstract search(query: string, signal?: AbortSignal): Promise<SearchResult>

  supportsParseLink = false

  /**
   * Parse/extract readable content from a URL.
   * Override in subclasses that support this capability.
   */
  async parseLink(_url: string, _signal?: AbortSignal): Promise<ParseLinkResult | null> {
    return null
  }

  async fetch(url: string, options: FetchOptions) {
    return ofetch(url, options)
  }
}

export default WebSearch
