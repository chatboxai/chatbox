import { getProviderDefinition, isBuiltinProviderId } from '@shared/providers'
import { ModelProviderEnum } from '@shared/types'

export type PlausibleOptions = {
  props?: Record<string, unknown>
  u?: string
}

export type Plausible = ((event: string, options?: PlausibleOptions) => void) & { q?: unknown[] }

export type PlausibleCountBucket = '0' | '1' | '2_5' | '6_plus'

const dynamicRoutePatterns = [
  {
    pattern: /^\/session\/[^/]+/,
    replacement: '/session/:sessionId',
  },
]

const providerRoutePattern = /^\/settings\/provider\/([^/]+)/

const attributionParams = new Set([
  'ref',
  'source',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
])

export function bucketPlausibleCount(count: number): PlausibleCountBucket {
  if (count <= 0) return '0'
  if (count === 1) return '1'
  if (count <= 5) return '2_5'
  return '6_plus'
}

export function normalizePlausibleVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)/)
  return match ? `${match[1]}.${match[2]}` : 'unknown'
}

export function normalizePlausibleProvider(providerId: string | undefined): string {
  if (!providerId) return 'unknown'
  return isBuiltinProviderId(providerId) ? providerId : 'custom'
}

export function normalizePlausibleModel(providerId: string | undefined, modelId: string | undefined): string {
  if (!modelId) return 'unknown'
  if (!providerId || normalizePlausibleProvider(providerId) === 'custom') return 'custom'
  if (providerId === ModelProviderEnum.ChatboxAI) return modelId

  const providerDefinition = getProviderDefinition(providerId)
  const knownModelIds = [
    ...(providerDefinition?.curatedModelIds || []),
    ...(providerDefinition?.defaultSettings?.models?.map((model) => model.modelId) || []),
  ]
  return knownModelIds.includes(modelId) ? modelId : 'custom'
}

function keepAttributionParams(search: string): string {
  const params = new URLSearchParams(search)
  for (const key of Array.from(params.keys())) {
    if (!attributionParams.has(key)) {
      params.delete(key)
    }
  }
  const filteredSearch = params.toString()
  return filteredSearch ? `?${filteredSearch}` : ''
}

export function normalizePlausiblePath(pathname: string): string {
  const providerRouteMatch = pathname.match(providerRoutePattern)
  if (providerRouteMatch) {
    const providerId = decodeURIComponent(providerRouteMatch[1])
    return isBuiltinProviderId(providerId)
      ? pathname
      : pathname.replace(providerRoutePattern, '/settings/provider/:providerId')
  }

  for (const { pattern, replacement } of dynamicRoutePatterns) {
    if (pattern.test(pathname)) {
      return pathname.replace(pattern, replacement)
    }
  }
  return pathname
}

/**
 * Keep Plausible's page dimension useful and prevent user-scoped route IDs from
 * being sent. Desktop and mobile use hash routing, while web uses pathname routing.
 */
export function normalizePlausibleUrl(href: string): string {
  const url = new URL(href)
  url.search = keepAttributionParams(url.search)

  if (url.hash.startsWith('#/')) {
    const hashUrl = new URL(url.hash.slice(1), 'https://plausible.invalid')
    hashUrl.pathname = normalizePlausiblePath(hashUrl.pathname)
    url.hash = `${hashUrl.pathname}${keepAttributionParams(hashUrl.search)}`
  } else {
    url.pathname = normalizePlausiblePath(url.pathname)
  }

  return url.href
}
