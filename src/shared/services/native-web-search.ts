/**
 * Native-safe web search for the RN mobile shell.
 *
 * Uses JSON HTTP APIs only (no DOMParser/HTML scraping), so it runs on React
 * Native `fetch`. Tavily is the first provider; `apiHost` is injectable so the
 * Android emulator can verify against a local mock without credentials.
 */

export interface NativeWebSearchResultItem {
  title: string
  link: string
  snippet: string
}

/** Same provider set the renderer's Web Search settings expose. */
export type NativeWebSearchProvider = 'build-in' | 'bing' | 'tavily' | 'bocha' | 'querit' | 'keenable'

export const nativeWebSearchProviderOptions: Array<{ id: NativeWebSearchProvider; label: string }> = [
  { id: 'build-in', label: 'Chatbox AI' },
  { id: 'bing', label: 'Bing Search' },
  { id: 'tavily', label: 'Tavily' },
  { id: 'bocha', label: 'BoCha' },
  { id: 'querit', label: 'Querit' },
  { id: 'keenable', label: 'Keenable' },
]

export interface NativeWebSearchSettings {
  enabled?: boolean
  provider: NativeWebSearchProvider
  apiKey: string
  apiHost: string
}

// Web parity (defaults.ts extension.webSearch.provider): the Chatbox search API
// is the default. Bare Bing scraping is unreliable from native HTTP clients --
// without a real browser UA/cookies Bing serves a JS shell with zero results.
export const defaultNativeWebSearchSettings: NativeWebSearchSettings = {
  provider: 'build-in',
  apiKey: '',
  apiHost: '',
}

export function normalizeNativeWebSearchSettings(
  settings: Partial<NativeWebSearchSettings> | undefined
): NativeWebSearchSettings {
  const provider = nativeWebSearchProviderOptions.some((option) => option.id === settings?.provider)
    ? (settings?.provider as NativeWebSearchProvider)
    : defaultNativeWebSearchSettings.provider
  return {
    enabled: settings?.enabled,
    provider,
    apiKey: settings?.apiKey ?? '',
    apiHost: settings?.apiHost ?? '',
  }
}

export interface NativeWebSearchOptions {
  provider?: NativeWebSearchProvider
  apiKey?: string
  apiHost?: string
  /** Chatbox license key, used by the `build-in` provider. */
  licenseKey?: string
  /** Chatbox API origin override for the `build-in` provider. */
  chatboxApiOrigin?: string
  signal?: AbortSignal
  fetchFn?: typeof fetch
  maxResults?: number
  /** Querit-only knobs (renderer settings webSearch.queritMaxResults / queritTimeRange). */
  queritTimeRange?: string | null
  /**
   * Extra headers merged into the request. The renderer's `build-in` provider injects the
   * Chatbox platform headers (CHATBOX-PLATFORM/VERSION/...) so the shared call matches the
   * old `webBrowsing` remote request.
   */
  headers?: Record<string, string>
}

const TAVILY_DEFAULT_HOST = 'https://api.tavily.com'
export const KEENABLE_DEFAULT_HOST = 'https://api.keenable.ai'
const CHATBOX_DEFAULT_ORIGIN = 'https://api.chatboxai.app'
const DEFAULT_MAX_RESULTS = 8

interface TavilyResponseItem {
  title?: string
  url?: string
  content?: string
}

export function hasNativeWebSearchConfiguration(
  settings: Pick<NativeWebSearchSettings, 'provider' | 'apiKey'>,
  licenseKey?: string
): boolean {
  if (settings.provider === 'tavily' || settings.provider === 'bocha' || settings.provider === 'querit') {
    return Boolean(settings.apiKey.trim())
  }
  if (settings.provider === 'build-in') return Boolean(licenseKey?.trim())
  return true // bing and keenable need no credentials
}

export async function searchNativeWeb(
  query: string,
  options: NativeWebSearchOptions
): Promise<NativeWebSearchResultItem[]> {
  const provider = options.provider ?? 'tavily'
  if (provider === 'bing') return searchNativeBing(query, options)
  if (provider === 'build-in') return searchNativeChatbox(query, options)
  if (provider === 'bocha') return searchNativeBocha(query, options)
  if (provider === 'querit') return searchNativeQuerit(query, options)
  if (provider === 'keenable') return searchNativeKeenable(query, options)
  return searchNativeTavily(query, options)
}

// BoCha and Querit are plain JSON APIs, shared verbatim with the renderer
// provider shells (packages/web-search/bocha.ts, querit.ts).

interface BochaResponse {
  code?: number | string
  msg?: string | null
  message?: string | null
  data?: { webPages?: { value?: Array<{ name: string; url: string; summary?: string; snippet?: string }> } }
  webPages?: { value?: Array<{ name: string; url: string; summary?: string; snippet?: string }> }
}

const BOCHA_ENDPOINTS = ['https://api.bocha.cn/v1/web-search', 'https://api.bochaai.com/v1/web-search']

async function searchNativeBocha(query: string, options: NativeWebSearchOptions): Promise<NativeWebSearchResultItem[]> {
  const fetchFn = options.fetchFn ?? fetch
  let payload: BochaResponse | undefined
  let lastError: unknown

  for (const endpoint of BOCHA_ENDPOINTS) {
    try {
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey ?? ''}`,
        },
        body: JSON.stringify({ query, freshness: 'noLimit', summary: true, count: 10 }),
        signal: options.signal,
      })
      if (!response.ok) {
        lastError = new Error(`BoCha API error: ${response.status}`)
        continue
      }
      const res = (await response.json()) as BochaResponse
      const responseCode = Number(res.code)
      if (!Number.isNaN(responseCode) && responseCode !== 200) {
        lastError = new Error(res.msg || res.message || `BoCha API error: ${res.code}`)
        continue
      }
      if ((res.code ?? null) !== null && Number.isNaN(responseCode)) {
        lastError = new Error(res.msg || res.message || `BoCha API error: ${res.code}`)
        continue
      }
      const results = res.data?.webPages?.value ?? res.webPages?.value
      if (!Array.isArray(results)) {
        lastError = new Error('BoCha API malformed payload: webPages.value is not an array')
        continue
      }
      payload = res
      break
    } catch (error) {
      lastError = error
    }
  }

  if (!payload) {
    throw lastError || new Error('BoCha API request failed on all endpoints')
  }

  const results = payload.data?.webPages?.value || payload.webPages?.value || []
  return results.map((result) => ({
    title: result.name,
    link: result.url,
    snippet: result.summary || result.snippet || '',
  }))
}

export const QUERIT_SEARCH_URL = 'https://api.querit.ai/v1/search'

async function searchNativeQuerit(
  query: string,
  options: NativeWebSearchOptions
): Promise<NativeWebSearchResultItem[]> {
  const fetchFn = options.fetchFn ?? fetch
  const timeRange = options.queritTimeRange === 'none' ? null : (options.queritTimeRange ?? null)
  const body: { query: string; count: number; filters?: { timeRange: { date: string } } } = {
    query,
    count: options.maxResults ?? 5,
  }
  if (timeRange) {
    body.filters = { timeRange: { date: timeRange } }
  }

  const response = await fetchFn(QUERIT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey ?? ''}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })
  if (!response.ok) {
    throw new Error(`Querit search failed with status ${response.status}`)
  }
  const payload = (await response.json()) as {
    error_code?: number
    error?: unknown
    results?: { result?: Array<{ title: string; url: string; snippet: string }> }
  }
  if (payload.error_code !== 200) {
    // Keep the renderer's diagnostic: an HTTP 200 with a business error_code
    // (e.g. invalid/expired key) otherwise yields zero results with no trace.
    console.error('Querit search API error:', payload.error_code, payload.error)
    return []
  }
  if (!payload.results?.result || !Array.isArray(payload.results.result)) {
    return []
  }
  return payload.results.result.map((result) => ({
    title: result.title,
    link: result.url,
    snippet: result.snippet,
  }))
}

// Keenable is keyless: `/v1/search/public` and `/v1/fetch/public` take no
// credentials, and an API key only raises the rate limit. The keyless endpoints
// require the caller to name itself in `X-Keenable-Title`.
export const KEENABLE_ATTRIBUTION = 'Chatbox'

/**
 * Keenable returns whole page text per result, not a SERP blurb, so it is capped
 * here. `snippet_max_length` is sent as well but the API treats it as a hint and
 * rounds up to a word boundary, so the local cap is the one that holds.
 */
export const KEENABLE_SNIPPET_MAX_LENGTH = 500

interface KeenableResponseItem {
  title?: string
  url?: string
  /** The page text. */
  snippet?: string
  /** The page meta description, empty for most pages. */
  description?: string
}

export function keenableHeaders(apiKey?: string): Record<string, string> {
  const key = apiKey?.trim()
  return {
    'X-Keenable-Title': KEENABLE_ATTRIBUTION,
    ...(key ? { 'X-API-Key': key } : {}),
  }
}

export function keenableSnippet(item: Pick<KeenableResponseItem, 'snippet' | 'description'>): string {
  return (item.snippet || item.description || '').replace(/\s+/g, ' ').trim().slice(0, KEENABLE_SNIPPET_MAX_LENGTH)
}

async function searchNativeKeenable(
  query: string,
  options: NativeWebSearchOptions
): Promise<NativeWebSearchResultItem[]> {
  const fetchFn = options.fetchFn ?? fetch
  const host = (options.apiHost?.trim() || KEENABLE_DEFAULT_HOST).replace(/\/+$/, '')
  const apiKey = options.apiKey?.trim()

  const response = await fetchFn(`${host}${apiKey ? '/v1/search' : '/v1/search/public'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...keenableHeaders(apiKey) },
    body: JSON.stringify({ query, snippet_max_length: KEENABLE_SNIPPET_MAX_LENGTH }),
    signal: options.signal,
  })
  if (!response.ok) {
    throw new Error(`Keenable search failed with status ${response.status}`)
  }

  const payload = (await response.json()) as { results?: KeenableResponseItem[] }
  const results = Array.isArray(payload.results) ? payload.results : []
  const items = results.map((item) => ({
    title: item.title ?? '',
    link: item.url ?? '',
    snippet: keenableSnippet(item),
  }))
  return options.maxResults !== undefined ? items.slice(0, options.maxResults) : items
}

async function searchNativeTavily(
  query: string,
  options: NativeWebSearchOptions
): Promise<NativeWebSearchResultItem[]> {
  const fetchFn = options.fetchFn ?? fetch
  const host = (options.apiHost?.trim() || TAVILY_DEFAULT_HOST).replace(/\/+$/, '')
  // Cap is opt-in: the renderer Tavily provider passes no maxResults, preserving the
  // pre-extraction behavior of returning every result Tavily sent (its own server-side
  // default). Native callers can pass maxResults to bound both request and response.
  const maxResults = options.maxResults

  const body: {
    query: string
    search_depth: string
    include_domains: string[]
    exclude_domains: string[]
    max_results?: number
  } = {
    query,
    search_depth: 'basic',
    include_domains: [],
    exclude_domains: [],
  }
  if (maxResults !== undefined) {
    body.max_results = maxResults
  }

  const response = await fetchFn(`${host}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey ?? ''}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })
  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}`)
  }

  const payload = (await response.json()) as { results?: TavilyResponseItem[] }
  const results = Array.isArray(payload.results) ? payload.results : []
  // No link filtering: matches the old renderer Tavily provider, which returned every
  // result Tavily sent (link-less items included) for the model to use.
  const items = results.map((item) => ({
    title: item.title ?? '',
    link: item.url ?? '',
    snippet: item.content ?? '',
  }))
  return maxResults !== undefined ? items.slice(0, maxResults) : items
}

/**
 * Chatbox build-in search — single implementation behind the renderer's `build-in`
 * provider (which injects an afetch `fetchFn` for retry + Chatbox error parsing, plus the
 * Chatbox platform `headers`) and the native shell. `POST /api/tool/web-search`, license
 * key as Authorization. Replaces the old `webBrowsing` remote fork.
 */
async function searchNativeChatbox(
  query: string,
  options: NativeWebSearchOptions
): Promise<NativeWebSearchResultItem[]> {
  const fetchFn = options.fetchFn ?? fetch
  const origin = (options.chatboxApiOrigin?.trim() || CHATBOX_DEFAULT_ORIGIN).replace(/\/+$/, '')

  const response = await fetchFn(`${origin}/api/tool/web-search`, {
    method: 'POST',
    headers: {
      Authorization: options.licenseKey ?? '',
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify({ query }),
    signal: options.signal,
  })
  const payload = (await response.json().catch(() => null)) as {
    error?: unknown
    data?: { links?: Array<{ title?: string; url?: string; content?: string }> }
  } | null
  if (!response.ok) {
    // afetch (renderer) throws its parsed Chatbox error before we get here; this path
    // gives the native plain-fetch caller a meaningful message instead of a bare status.
    const message =
      payload && typeof payload.error === 'string' ? payload.error : `Web search failed with status ${response.status}`
    throw new Error(message)
  }
  // No client-side cap or link filtering: matches the old `webBrowsing` remote call, which
  // returned every link the Chatbox backend sent (already a bounded ~10 Serper organic
  // results + PeopleAlsoAsk set), so trimming here would only drop the tail.
  const links = payload?.data?.links ?? []
  return links.map((link) => ({
    title: link.title ?? '',
    link: link.url ?? '',
    snippet: link.content ?? '',
  }))
}

/**
 * Bing SERP search — the renderer's BingSearch port. React Native has no
 * DOMParser, so the `li.b_algo` items are extracted with tolerant regexes.
 */
async function searchNativeBing(query: string, options: NativeWebSearchOptions): Promise<NativeWebSearchResultItem[]> {
  const fetchFn = options.fetchFn ?? fetch
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS
  const response = await fetchFn(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
    method: 'GET',
    headers: {
      // Bing serves an empty JS shell to non-browser clients (okhttp/CFNetwork),
      // so present a desktop browser. Results are still best-effort.
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: options.signal,
  })
  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}`)
  }
  const html = await response.text()
  return extractBingResults(html).slice(0, maxResults)
}

export function extractBingResults(html: string): NativeWebSearchResultItem[] {
  const items: NativeWebSearchResultItem[] = []
  const liPattern = /<li class="b_algo[^"]*"[\s\S]*?(?=<li class="b_algo|<\/ol>|$)/g
  for (const block of html.match(liPattern) ?? []) {
    const anchor = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!anchor) continue
    const link = decodeHtmlEntities(anchor[1])
    const title = decodeHtmlEntities(stripTags(anchor[2])).trim()
    if (!link || !title) continue
    const snippetMatch =
      /<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(block) ??
      /<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/.exec(block)
    const snippet = snippetMatch ? decodeHtmlEntities(stripTags(snippetMatch[1])).trim() : ''
    items.push({ title, link, snippet })
  }
  return items
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '')
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

export function formatNativeWebSearchContext(query: string, items: NativeWebSearchResultItem[]): string {
  if (items.length === 0) return ''
  const entries = items
    .map((item, index) => `${index + 1}. ${item.title}\n${item.link}\n${item.snippet}`.trim())
    .join('\n\n')
  return [
    '<WEB_SEARCH_RESULTS>',
    `The following are web search results for the query: ${query}`,
    'Use them to ground your answer and cite sources by their URLs when relevant.',
    '',
    entries,
    '</WEB_SEARCH_RESULTS>',
  ].join('\n')
}
