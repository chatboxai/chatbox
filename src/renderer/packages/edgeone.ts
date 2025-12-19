import { ofetch } from 'ofetch'
import platform from '@/platform'
import { handleMobileRequest } from '@/utils/mobile-request'

const EDGEONE_BASE_URL_ENDPOINT = 'https://mcp.edgeone.site/get_base_url'
const BASE_URL_TTL = 60 * 1000

let cachedBaseUrl: { value: string; expiresAt: number } | null = null

function generateInstallationId(length = 8): string {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const array = new Uint8Array(length)
    crypto.getRandomValues(array)
    return Array.from(array)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  const fallback = Array.from({ length }, () => Math.floor(Math.random() * 256))
  return fallback.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function httpGet(url: string): Promise<unknown> {
  if (platform.type === 'mobile') {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    const response = await handleMobileRequest(url, 'GET', headers)
    return response.json()
  }
  return ofetch(url)
}

async function httpPost(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<unknown> {
  if (platform.type === 'mobile') {
    const reqHeaders = new Headers({ 'Content-Type': 'application/json', ...headers })
    const response = await handleMobileRequest(url, 'POST', reqHeaders, JSON.stringify(body))
    return response.json()
  }
  return ofetch(url, { method: 'POST', headers, body })
}

async function fetchBaseUrl(): Promise<string> {
  const response = await httpGet(EDGEONE_BASE_URL_ENDPOINT)
  const { baseUrl } = typeof response === 'string' ? JSON.parse(response) : (response as { baseUrl?: string })
  if (!baseUrl) {
    throw new Error('EdgeOne base URL is unavailable.')
  }
  cachedBaseUrl = {
    value: baseUrl,
    expiresAt: Date.now() + BASE_URL_TTL,
  }
  return baseUrl
}

export function getEdgeOneBaseUrl(force = false): Promise<string> {
  if (!force && cachedBaseUrl && cachedBaseUrl.expiresAt > Date.now()) {
    return Promise.resolve(cachedBaseUrl.value)
  }
  return fetchBaseUrl()
}

export async function deployHtmlToEdgeOne(value: string): Promise<string> {
  if (!value?.trim()) {
    throw new Error('HTML content is empty, nothing to deploy.')
  }

  const baseUrl = await getEdgeOneBaseUrl()
  const response = await httpPost(baseUrl, { value }, { 'X-Installation-ID': generateInstallationId() })

  const data = typeof response === 'string' ? JSON.parse(response) : (response as { url?: string; error?: string })

  if (data.url) {
    return data.url
  }

  throw new Error(data.error || 'Failed to deploy HTML to EdgeOne Pages.')
}
