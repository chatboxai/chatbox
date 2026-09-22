export const ANYSEARCH_API_BASE_URL = 'https://api.anysearch.com'
export const ANYSEARCH_SEARCH_ENDPOINT = `${ANYSEARCH_API_BASE_URL}/v1/search`
export const ANYSEARCH_SUB_DOMAINS_ENDPOINT = `${ANYSEARCH_API_BASE_URL}/v1/sub-domains`
export const ANYSEARCH_EXTRACT_ENDPOINT = `${ANYSEARCH_API_BASE_URL}/v1/extract`

export const ANYSEARCH_DOMAINS = [
  'general',
  'resource',
  'social_media',
  'finance',
  'academic',
  'legal',
  'health',
  'business',
  'security',
  'ip',
  'code',
  'energy',
  'environment',
  'agriculture',
  'travel',
  'film',
  'gaming',
] as const

export type AnysearchDomain = (typeof ANYSEARCH_DOMAINS)[number]
export type AnysearchZone = 'cn' | 'intl'
export type AnysearchToolName = 'search' | 'batch_search' | 'get_sub_domains' | 'extract'

export interface AnysearchSearchRequest {
  query: string
  domain?: AnysearchDomain
  sub_domain?: string
  sub_domain_params?: Record<string, unknown>
  max_results?: number
  zone?: AnysearchZone
  language?: string
}

export interface AnysearchOptions {
  apiKey?: string
  fetchFn?: typeof fetch
  signal?: AbortSignal
  zone?: AnysearchZone
  language?: string
}

interface AnysearchApiResponse {
  code?: number
  message?: string
  request_id?: string
  data?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

export interface AnysearchSearchResultItem {
  title: string
  link: string
  snippet: string
}

export interface AnysearchExtractResult {
  url: string
  title: string
  content: string
}

export interface AnysearchGeneratedCredential {
  apiKey: string
}

/**
 * Anonymous callers that exceed the daily free quota are rejected with HTTP
 * 402 whose message carries generated credentials, and the documented flow is
 * to resubmit the request with that API key. The password in the same block is
 * dropped on purpose: only the key is used, and no secret is ever attached to
 * an error that could reach logs, analytics, or the conversation.
 */
export class AnysearchQuotaExhaustedError extends Error {
  readonly credential: AnysearchGeneratedCredential | null

  constructor(message: string, credential: AnysearchGeneratedCredential | null) {
    super(message)
    this.name = 'AnysearchQuotaExhaustedError'
    this.credential = credential
  }
}

const CREDENTIAL_LINE = /^\s*(username|password|api_key)\s*=\s*(.+)$/i

export function parseAnysearchGeneratedCredential(message: string): AnysearchGeneratedCredential | null {
  for (const line of message.split(/\r?\n/)) {
    const match = CREDENTIAL_LINE.exec(line)
    if (!match || match[1].toLowerCase() !== 'api_key') continue
    const apiKey = match[2].trim()
    if (apiKey) return { apiKey }
  }
  return null
}

function stripAnysearchCredentialBlock(message: string): string {
  return message
    .split(/\r?\n/)
    .filter((line) => !CREDENTIAL_LINE.test(line))
    .join('\n')
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Reads the error message from the REST envelope. Platform fetch wrappers can
 * flatten the HTTP status to 200, so the payload has to carry the failure.
 */
function readAnysearchErrorMessage(payload: AnysearchApiResponse | null): string | null {
  const code = payload?.code
  if (typeof code === 'number' && code !== 0 && typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message.trim()
  }
  const nestedMessage = payload?.error?.message
  if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage.trim()
  return null
}

export function parseAnysearchExtractResult(text: string, fallbackUrl: string): AnysearchExtractResult {
  try {
    const root = JSON.parse(text) as unknown
    const payload = isRecord(root) && isRecord(root.data) ? root.data : root
    if (isRecord(payload) && typeof payload.content === 'string') {
      return {
        url: typeof payload.url === 'string' && payload.url.trim() ? payload.url : fallbackUrl,
        title: typeof payload.title === 'string' ? payload.title : '',
        content: payload.content,
      }
    }
  } catch {}
  return { url: fallbackUrl, title: '', content: text }
}

function clampMaxResults(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return Math.min(Math.max(Math.trunc(value), 1), 10)
}

export function normalizeAnysearchSearchRequest(request: AnysearchSearchRequest): AnysearchSearchRequest {
  const query = request.query.trim()
  if (!query) throw new Error('Anysearch query is required')
  if (request.domain && !request.sub_domain?.trim()) {
    throw new Error('Anysearch vertical search requires a sub_domain returned by get_sub_domains')
  }
  if (!request.domain && (request.sub_domain?.trim() || request.sub_domain_params)) {
    throw new Error('Anysearch sub_domain and sub_domain_params require a domain')
  }
  if (request.zone && request.zone !== 'cn' && request.zone !== 'intl') {
    throw new Error('Anysearch zone must be cn or intl')
  }

  const normalized: AnysearchSearchRequest = { query }
  if (request.domain) normalized.domain = request.domain
  if (request.sub_domain?.trim()) normalized.sub_domain = request.sub_domain.trim()
  if (request.sub_domain_params) normalized.sub_domain_params = request.sub_domain_params
  const maxResults = clampMaxResults(request.max_results)
  if (maxResults !== undefined) normalized.max_results = maxResults
  if (request.zone) normalized.zone = request.zone
  const language = request.language?.trim()
  if (language) normalized.language = language
  return normalized
}

function toAnysearchTag(request: AnysearchSearchRequest): string | undefined {
  const subDomain = request.sub_domain?.trim()
  if (!subDomain) return undefined
  return subDomain.includes('.') ? subDomain : `${request.domain}.${subDomain}`
}

function toAnysearchSearchBody(request: AnysearchSearchRequest, options: AnysearchOptions): Record<string, unknown> {
  const normalized = normalizeAnysearchSearchRequest(request)
  const body: Record<string, unknown> = {
    query: normalized.query,
    format: 'json',
  }

  if (normalized.max_results !== undefined) body.max_results = normalized.max_results
  const tag = toAnysearchTag(normalized)
  if (tag) body.tag = tag
  if (normalized.sub_domain_params) body.params = normalized.sub_domain_params
  if (normalized.zone ?? options.zone) body.zone = normalized.zone ?? options.zone
  if (normalized.language ?? options.language) body.language = normalized.language ?? options.language
  return body
}

function createAnysearchHeaders(apiKey: string | undefined, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (hasBody) headers['Content-Type'] = 'application/json'
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

async function readAnysearchResponse(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as AnysearchApiResponse | null
  const errorMessage = readAnysearchErrorMessage(payload)
  if (errorMessage) {
    const credential = parseAnysearchGeneratedCredential(errorMessage)
    if (credential) {
      throw new AnysearchQuotaExhaustedError(
        stripAnysearchCredentialBlock(errorMessage) || 'Anysearch free quota exhausted',
        credential
      )
    }
    throw new Error(errorMessage)
  }
  if (!response.ok) {
    throw new Error(`Anysearch request failed with status ${response.status}`)
  }
  if (!isRecord(payload)) {
    throw new Error('Anysearch returned a malformed response without JSON content')
  }
  return JSON.stringify(payload)
}

export async function callAnysearchTool(
  name: AnysearchToolName,
  args: Record<string, unknown>,
  options: AnysearchOptions = {}
): Promise<string> {
  if (name === 'batch_search') {
    const queries = args.queries
    if (!Array.isArray(queries)) throw new Error('Anysearch batch_search requires a queries array')
    return batchSearchAnysearch(queries as AnysearchSearchRequest[], options)
  }

  const fetchFn = options.fetchFn ?? fetch
  const apiKey = options.apiKey?.trim() || undefined
  let response: Response

  if (name === 'get_sub_domains') {
    const url = new URL(ANYSEARCH_SUB_DOMAINS_ENDPOINT)
    const domains = args.domains
    if (!Array.isArray(domains)) throw new Error('Anysearch get_sub_domains requires a domains array')
    for (const domain of domains) url.searchParams.append('domain', String(domain))
    response = await fetchFn(url, {
      method: 'GET',
      headers: createAnysearchHeaders(apiKey, false),
      signal: options.signal,
    })
  } else {
    const endpoint = name === 'extract' ? ANYSEARCH_EXTRACT_ENDPOINT : ANYSEARCH_SEARCH_ENDPOINT
    const body =
      name === 'extract' ? { url: args.url } : toAnysearchSearchBody(args as unknown as AnysearchSearchRequest, options)
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers: createAnysearchHeaders(apiKey, true),
      body: JSON.stringify(body),
      signal: options.signal,
    })
  }

  return readAnysearchResponse(response)
}

export async function searchAnysearch(
  request: AnysearchSearchRequest,
  options: AnysearchOptions = {}
): Promise<string> {
  return callAnysearchTool(
    'search',
    normalizeAnysearchSearchRequest(request) as unknown as Record<string, unknown>,
    options
  )
}

export async function batchSearchAnysearch(
  queries: AnysearchSearchRequest[],
  options: AnysearchOptions = {}
): Promise<string> {
  if (queries.length < 1 || queries.length > 5) {
    throw new Error('Anysearch batch_search requires between 1 and 5 queries')
  }
  const normalizedQueries = queries.map(normalizeAnysearchSearchRequest)
  const responses = await Promise.all(normalizedQueries.map((query) => searchAnysearch(query, options)))
  const parsedResponses = responses.map((response) => {
    try {
      return JSON.parse(response) as unknown
    } catch {
      return response
    }
  })
  return JSON.stringify({
    code: 0,
    message: 'success',
    data: {
      queries: normalizedQueries.map((query, index) => ({ query: query.query, response: parsedResponses[index] })),
    },
  })
}

export async function getAnysearchSubDomains(
  domains: AnysearchDomain[],
  options: AnysearchOptions = {}
): Promise<string> {
  if (domains.length < 1 || domains.length > 5) {
    throw new Error('Anysearch get_sub_domains requires between 1 and 5 domains')
  }
  return callAnysearchTool('get_sub_domains', { domains }, options)
}

export async function extractAnysearch(url: string, options: AnysearchOptions = {}): Promise<AnysearchExtractResult> {
  const normalizedUrl = new URL(url)
  if (normalizedUrl.protocol !== 'http:' && normalizedUrl.protocol !== 'https:') {
    throw new Error('Anysearch extract requires an HTTP or HTTPS URL')
  }
  const text = await callAnysearchTool('extract', { url: normalizedUrl.toString() }, options)
  return parseAnysearchExtractResult(text, normalizedUrl.toString())
}

function parseAnysearchJsonSearchResults(payload: unknown): AnysearchSearchResultItem[] | null {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.results)) return null
  return payload.data.results.flatMap((item) => {
    if (!isRecord(item) || typeof item.url !== 'string' || !item.url) return []
    return [
      {
        title: typeof item.title === 'string' ? item.title : '',
        link: item.url,
        snippet:
          typeof item.snippet === 'string'
            ? item.snippet
            : typeof item.content === 'string'
              ? item.content
              : '',
      },
    ]
  })
}

const RESULT_HEADING = /^###\s+\d+\.\s+(.+)$/gm
const RESULT_URL = /^-\s+\*\*URL\*\*:\s+(https?:\/\/\S+)\s*$/m

export function parseAnysearchSearchResults(payloadText: string): AnysearchSearchResultItem[] {
  try {
    const payload = JSON.parse(payloadText) as unknown
    const results = parseAnysearchJsonSearchResults(payload)
    if (results) return results
  } catch {}

  const headings = [...payloadText.matchAll(RESULT_HEADING)]
  const items: AnysearchSearchResultItem[] = []

  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index]
    const start = (heading.index ?? 0) + heading[0].length
    const end = headings[index + 1]?.index ?? payloadText.length
    const section = payloadText.slice(start, end).trim()
    const urlMatch = section.match(RESULT_URL)
    if (!urlMatch) continue
    const snippet = section.replace(RESULT_URL, '').trim().replace(/^-\s*/, '')
    items.push({ title: heading[1].trim(), link: urlMatch[1], snippet })
  }

  if (items.length === 0 && !/\b0\s+results?\b|no (?:search )?results/i.test(payloadText)) {
    throw new Error('Anysearch returned an unrecognized search result format')
  }
  return items
}
