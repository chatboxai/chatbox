import { cachified } from '@epic-web/cachified'
import type { SearchResultItem } from '@shared/types'
import { truncate } from 'lodash'
import platform from '@/platform'
import { getExtensionSettings, getLanguage, getLicenseKey } from '@/stores/settingActions'
import { settingsStore } from '@/stores/settingsStore'
import { ChatboxAIAPIError } from '../../../shared/models/errors'
import { AnysearchSearch, normalizeAnysearchLanguage } from './anysearch'
import type WebSearch from './base'
import { BingSearch } from './bing'
import { BingNewsSearch } from './bing-news'
import { BochaSearch } from './bocha'
import { ChatboxSearch } from './chatbox-search'
import { QueritSearch } from './querit'
import { normalizeSearxngBaseUrl, SearxngSearch } from './searxng'
import { TavilySearch } from './tavily'

const MAX_CONTEXT_ITEMS = 10

/**
 * Anysearch hands a generated key to anonymous callers that ran out of the
 * daily free quota. Keeping it in the settings field means later searches go
 * straight to the authenticated path instead of paying another 402 round trip.
 */
function saveAnysearchGeneratedApiKey(apiKey: string) {
  settingsStore.getState().setSettings((draft) => {
    draft.extension.webSearch.anysearchApiKey = apiKey
  })
}

// 根据配置的搜索提供方来选择搜索服务
function getSearchProviders() {
  const settings = getExtensionSettings()
  const licenseKey = getLicenseKey()

  const selectedProviders: WebSearch[] = []
  const provider = settings.webSearch.provider
  const language = getLanguage()
  const anysearchLanguage = normalizeAnysearchLanguage(language)

  switch (provider) {
    case 'build-in':
      if (!licenseKey) {
        throw ChatboxAIAPIError.fromCodeName(
          'chatbox_search_license_key_required',
          'chatbox_search_license_key_required'
        )
      }
      selectedProviders.push(new ChatboxSearch(licenseKey))
      break
    case 'bing':
      selectedProviders.push(new BingSearch())
      if (language !== 'zh-Hans' && platform.type !== 'mobile') {
        selectedProviders.push(new BingNewsSearch()) // 国内和移动端容易被重定向到 Bing 首页
      }
      break
    case 'tavily':
      if (!settings.webSearch.tavilyApiKey) {
        throw ChatboxAIAPIError.fromCodeName('tavily_api_key_required', 'tavily_api_key_required')
      }
      selectedProviders.push(new TavilySearch(settings.webSearch.tavilyApiKey))
      break
    case 'bocha':
      if (!settings.webSearch.bochaApiKey) {
        throw ChatboxAIAPIError.fromCodeName('bocha_api_key_required', 'bocha_api_key_required')
      }
      selectedProviders.push(new BochaSearch(settings.webSearch.bochaApiKey))
      break
    case 'querit':
      if (!settings.webSearch.queritApiKey) {
        throw ChatboxAIAPIError.fromCodeName('querit_api_key_required', 'querit_api_key_required')
      }
      selectedProviders.push(
        new QueritSearch(
          settings.webSearch.queritApiKey,
          settings.webSearch.queritMaxResults,
          settings.webSearch.queritTimeRange
        )
      )
      break
    case 'searxng': {
      const searxngBaseUrl = normalizeSearxngBaseUrl(settings.webSearch.searxngBaseUrl ?? '')
      if (!searxngBaseUrl) {
        throw ChatboxAIAPIError.fromCodeName('searxng_base_url_required', 'searxng_base_url_required')
      }
      selectedProviders.push(new SearxngSearch(searxngBaseUrl))
      break
    }
    case 'anysearch':
      // A missing key is valid: Anysearch falls back to its anonymous mode.
      selectedProviders.push(
        new AnysearchSearch(
          settings.webSearch.anysearchApiKey?.trim(),
          settings.webSearch.anysearchMaxResults ?? 10,
          saveAnysearchGeneratedApiKey,
          {
            zone: settings.webSearch.anysearchZone,
            language: anysearchLanguage,
          }
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
        return { result }
      } catch (err) {
        console.error(err)
        return { error: err }
      }
    })
  )

  const successfulResults = results.flatMap((entry) => (entry.result ? [entry.result] : []))
  if (successfulResults.length === 0) {
    throw results[0]?.error ?? new Error('Web search failed')
  }

  const items: SearchResultItem[] = []

  // add items in turn
  let i = 0
  let hasMore = false
  do {
    hasMore = false
    for (const result of successfulResults) {
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
  const webSearch = getExtensionSettings().webSearch
  const provider = webSearch.provider
  const cacheIdentity = (() => {
    if (provider === 'searxng') return `${provider}:${normalizeSearxngBaseUrl(webSearch.searxngBaseUrl ?? '')}`
    if (provider === 'anysearch') {
      return [
        provider,
        webSearch.anysearchMaxResults ?? 10,
        webSearch.anysearchZone ?? 'auto',
        normalizeAnysearchLanguage(getLanguage()) ?? 'auto',
      ].join(':')
    }
    return provider
  })()
  const searchResults = await cachified({
    cache,
    key: `search-context:${cacheIdentity}:${query}`,
    ttl: 1000 * 60 * 5,
    getFreshValue: () => _searchRelatedResults(query, abortSignal),
  })
  return { query, searchResults }
}

/**
 * Single source of truth: which configured providers offer the parse_link tool.
 * Keep in sync with the provider classes' `supportsParseLink` flags.
 */
export const PROVIDERS_WITH_PARSE_LINK: ReadonlySet<string> = new Set(['build-in', 'tavily', 'anysearch'])

/**
 * Returns the first configured search provider that supports parseLink.
 * Throws the underlying provider error (e.g. missing API key) — caller decides how to handle.
 */
export function getParseLinkProvider(): WebSearch | null {
  const providers = getSearchProviders()
  return providers.find((p) => p.supportsParseLink) ?? null
}

export function getAnysearchProvider(): AnysearchSearch | null {
  const providers = getSearchProviders()
  return providers.find((provider): provider is AnysearchSearch => provider instanceof AnysearchSearch) ?? null
}

export type { SearchResultItem }
