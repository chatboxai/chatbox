import { cachified } from '@epic-web/cachified'
import type { SearchResultItem } from '@shared/types'
import { truncate } from 'lodash'
import platform from '@/platform'
import { getExtensionSettings, getLanguage } from '@/stores/settingActions'
import { CodedError } from '../../../shared/models/errors'
import type WebSearch from './base'
import { BingSearch } from './bing'
import { BingNewsSearch } from './bing-news'
import { BochaSearch } from './bocha'
import { QueritSearch } from './querit'
import { TavilySearch } from './tavily'

const MAX_CONTEXT_ITEMS = 10

// 根据配置的搜索提供方来选择搜索服务
function getSearchProviders() {
  const settings = getExtensionSettings()

  const selectedProviders: WebSearch[] = []
  const provider = settings.webSearch.provider
  const language = getLanguage()

  switch (provider) {
    case 'bing':
      selectedProviders.push(new BingSearch())
      if (language !== 'zh-Hans') {
        selectedProviders.push(new BingNewsSearch()) // 国内容易被重定向到 Bing 首页
      }
      break
    case 'tavily':
      if (!settings.webSearch.tavilyApiKey) {
        throw CodedError.fromCodeName('tavily_api_key_required', 'tavily_api_key_required')
      }
      selectedProviders.push(new TavilySearch(settings.webSearch.tavilyApiKey))
      break
    case 'bocha':
      if (!settings.webSearch.bochaApiKey) {
        throw CodedError.fromCodeName('bocha_api_key_required', 'bocha_api_key_required')
      }
      selectedProviders.push(new BochaSearch(settings.webSearch.bochaApiKey))
      break
    case 'querit':
      if (!settings.webSearch.queritApiKey) {
        throw CodedError.fromCodeName('querit_api_key_required', 'querit_api_key_required')
      }
      selectedProviders.push(
        new QueritSearch(
          settings.webSearch.queritApiKey,
          settings.webSearch.queritMaxResults,
          settings.webSearch.queritTimeRange
        )
      )
      break
    default:
      throw new Error(`Unsupported search provider: ${provider}`)
  }

  return selectedProviders
}

async function _searchRelatedResults(query: string, signal?: AbortSignal) {
  const providers = getSearchProviders()
  const results = await Promise.all(
    providers.map(async (provider) => {
      try {
        const result = await provider.search(query, signal)
        console.debug(`web search result for "${query}":`, result.items)
        return result
      } catch (err) {
        console.error(err)
        return { items: [] }
      }
    })
  )

  const items: SearchResultItem[] = []

  // add items in turn
  let i = 0
  let hasMore = false
  do {
    hasMore = false
    for (const result of results) {
      const item = result.items[i]
      if (item) {
        hasMore = true
        items.push(item)
      } else {
      }
    }
    i++
  } while (hasMore && items.length < MAX_CONTEXT_ITEMS)

  console.debug('web search items', items)

  return items.map((item) => ({
    title: item.title,
    snippet: truncate(item.snippet, { length: 150 }),
    link: item.link,
  }))
}

const cache = new Map()

export const webSearchExecutor = async (
  { query }: { query: string },
  { abortSignal }: { abortSignal?: AbortSignal }
) => {
  const searchResults = await cachified({
    cache,
    key: `search-context:${query}`,
    ttl: 1000 * 60 * 5,
    getFreshValue: () => _searchRelatedResults(query, abortSignal),
  })
  return { query, searchResults }
}

/**
 * Single source of truth: which configured providers offer the parse_link tool.
 * Keep in sync with the provider classes' `supportsParseLink` flags.
 */
export const PROVIDERS_WITH_PARSE_LINK: ReadonlySet<string> = new Set(['tavily'])

/**
 * Returns the first configured search provider that supports parseLink.
 * Throws the underlying provider error (e.g. missing API key) — caller decides how to handle.
 */
export function getParseLinkProvider(): WebSearch | null {
  const providers = getSearchProviders()
  return providers.find((p) => p.supportsParseLink) ?? null
}

export type { SearchResultItem }
