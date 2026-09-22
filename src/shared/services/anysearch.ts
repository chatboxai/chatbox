export const ANYSEARCH_ENDPOINT = 'https://api.anysearch.com/mcp'
export const ANYSEARCH_CLIENT_HEADER = 'chatbox/1.0'

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
export type AnysearchToolName = 'search' | 'batch_search' | 'get_sub_domains' | 'extract'

export interface AnysearchSearchRequest {
  query: string
  domain?: AnysearchDomain
  sub_domain?: string
  sub_domain_params?: Record<string, unknown>
  max_results?: number
}

export interface AnysearchOptions {
  apiKey?: string
  fetchFn?: typeof fetch
  signal?: AbortSignal
}

interface AnysearchJsonRpcResponse {
  error?: { code?: number; message?: string; data?: unknown }
  result?: { content?: Array<{ type?: string; text?: string }> }
  /** REST-style envelope used by gateway errors (401/402/403/429/502). */
  code?: number
  message?: string
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

/**
 * Reads the error message from either envelope shape. Platform fetch wrappers
 * flatten the HTTP status to 200, so the payload has to carry the failure.
 */
function readAnysearchErrorMessage(payload: AnysearchJsonRpcResponse | null): string | null {
  const code = payload?.code
  if (typeof code === 'number' && code !== 0 && typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message.trim()
  }
  const jsonRpcMessage = payload?.error?.message
  if (typeof jsonRpcMessage === 'string' && jsonRpcMessage.trim()) return jsonRpcMessage.trim()
  return null
}

export function parseAnysearchExtractResult(text: string, fallbackUrl: string): AnysearchExtractResult {
  try {
    const payload = JSON.parse(text) as { url?: unknown; title?: unknown; content?: unknown }
    if (payload && typeof payload === 'object' && typeof payload.content === 'string') {
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
  const normalized: AnysearchSearchRequest = { query }
  if (request.domain) normalized.domain = request.domain
  if (request.sub_domain?.trim()) normalized.sub_domain = request.sub_domain.trim()
  if (request.sub_domain_params) normalized.sub_domain_params = request.sub_domain_params
  const maxResults = clampMaxResults(request.max_results)
  if (maxResults !== undefined) normalized.max_results = maxResults
  return normalized
}

export async function callAnysearchTool(
  name: AnysearchToolName,
  args: Record<string, unknown>,
  options: AnysearchOptions = {}
): Promise<string> {
  const fetchFn = options.fetchFn ?? fetch
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Anysearch-Client': ANYSEARCH_CLIENT_HEADER,
  }
  const apiKey = options.apiKey?.trim()
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const response = await fetchFn(ANYSEARCH_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: options.signal,
  })
  const payload = (await response.json().catch(() => null)) as AnysearchJsonRpcResponse | null
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
  const text = payload?.result?.content?.find((item) => item.type === 'text' && typeof item.text === 'string')?.text
  if (typeof text !== 'string') {
    throw new Error('Anysearch returned a malformed response without text content')
  }
  return text
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
  return callAnysearchTool('batch_search', { queries: queries.map(normalizeAnysearchSearchRequest) }, options)
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

const RESULT_HEADING = /^###\s+\d+\.\s+(.+)$/gm
const RESULT_URL = /^-\s+\*\*URL\*\*:\s+(https?:\/\/\S+)\s*$/m

export function parseAnysearchSearchResults(markdown: string): AnysearchSearchResultItem[] {
  const headings = [...markdown.matchAll(RESULT_HEADING)]
  const items: AnysearchSearchResultItem[] = []

  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index]
    const start = (heading.index ?? 0) + heading[0].length
    const end = headings[index + 1]?.index ?? markdown.length
    const section = markdown.slice(start, end).trim()
    const urlMatch = section.match(RESULT_URL)
    if (!urlMatch) continue
    const snippet = section.replace(RESULT_URL, '').trim().replace(/^-\s*/, '')
    items.push({ title: heading[1].trim(), link: urlMatch[1], snippet })
  }

  if (items.length === 0 && !/\b0\s+results?\b|no (?:search )?results/i.test(markdown)) {
    throw new Error('Anysearch returned an unrecognized search result format')
  }
  return items
}
