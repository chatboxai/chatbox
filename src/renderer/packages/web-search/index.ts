import { cachified } from '@epic-web/cachified'
import type { SearchResultItem } from '@shared/types'
import { truncate } from 'lodash'
import { getExtensionSettings, getLanguage } from '@/stores/settingActions'
import { ChatboxAIAPIError } from '../../../shared/models/errors'
import type WebSearch from './base'
import { BingSearch } from './bing'
import { BingNewsSearch } from './bing-news'
import { TavilySearch } from './tavily'

const MAX_CONTEXT_ITEMS = 10

// 根据配置的搜索提供方来选择搜索服务
function getSearchProviders() {
  const settings = getExtensionSettings()

  const selectedProviders: WebSearch[] = []
  const provider = settings.webSearch.provider
  const language = getLanguage()
  const addBingProviders = () => {
    selectedProviders.push(new BingSearch())
    if (language !== 'zh-Hans') {
      selectedProviders.push(new BingNewsSearch()) // 国内无法使用
    }
  }

  switch (provider) {
    case 'build-in':
      // Chatbox paid search is disabled in this build.
      // Fallback to free Bing search for legacy settings values.
      addBingProviders()
      break
    case 'bing':
      addBingProviders()
      break
    case 'tavily':
      if (!settings.webSearch.tavilyApiKey) {
        throw ChatboxAIAPIError.fromCodeName('tavily_api_key_required', 'tavily_api_key_required')
      }
      selectedProviders.push(
        new TavilySearch(
          settings.webSearch.tavilyApiKey,
          settings.webSearch.tavilySearchDepth,
          settings.webSearch.tavilyMaxResults,
          settings.webSearch.tavilyTimeRange,
          settings.webSearch.tavilyIncludeRawContent
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
    rawContent: item.rawContent,
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

export type { SearchResultItem }
