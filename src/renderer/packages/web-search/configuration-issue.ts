import { type NativeWebSearchCredentialSources, resolveNativeWebSearchApiKey } from '@shared/services/native-web-search'
import type { WebSearchProviderValue } from './constants'

export type WebSearchFallbackValue = WebSearchProviderValue | 'none'

export type WebSearchReadinessSettings = NativeWebSearchCredentialSources & {
  extension: {
    webSearch: {
      provider: WebSearchProviderValue
      searxngBaseUrl?: string
      /** Provider retried when the primary one fails; `none` disables the fallback. */
      fallbackProvider?: WebSearchFallbackValue
    }
  }
  licenseKey?: string
}

export type WebSearchConfigurationIssue =
  | 'chatbox-ai-sign-in'
  | 'deepseek-api-key'
  | 'kimi-api-key'
  | 'glm-api-key'
  | 'tavily-api-key'
  | 'bocha-api-key'
  | 'querit-api-key'
  | 'searxng-instance'

function resolveProviderIssue(
  settings: WebSearchReadinessSettings,
  provider: WebSearchProviderValue
): WebSearchConfigurationIssue | null {
  switch (provider) {
    case 'build-in':
      return settings.licenseKey ? null : 'chatbox-ai-sign-in'
    case 'searxng':
      return settings.extension.webSearch.searxngBaseUrl?.trim() ? null : 'searxng-instance'
    case 'bing':
      return null
    default:
      return resolveNativeWebSearchApiKey(settings, provider).trim() ? null : (`${provider}-api-key` as const)
  }
}

/**
 * Reports the configuration problem that would make a web search fail.
 *
 * A configured fallback covers an unusable primary provider: the search still
 * runs (through the fallback), so it is not reported as a configuration issue.
 */
export function getWebSearchConfigurationIssue(
  settings: WebSearchReadinessSettings,
  provider: WebSearchProviderValue = settings.extension.webSearch.provider
): WebSearchConfigurationIssue | null {
  const issue = resolveProviderIssue(settings, provider)
  if (!issue) return null

  const fallback = settings.extension.webSearch.fallbackProvider
  if (fallback && fallback !== 'none' && fallback !== provider && !resolveProviderIssue(settings, fallback)) {
    return null
  }
  return issue
}
