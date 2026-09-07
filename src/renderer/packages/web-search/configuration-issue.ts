import type { WebSearchProviderValue } from './constants'

type WebSearchConfiguration = {
  provider: WebSearchProviderValue
  tavilyApiKey?: string
  bochaApiKey?: string
  queritApiKey?: string
  searxngBaseUrl?: string
}

export type WebSearchConfigurationIssue =
  | 'chatbox-ai-sign-in'
  | 'tavily-api-key'
  | 'bocha-api-key'
  | 'querit-api-key'
  | 'searxng-instance'

export function getWebSearchConfigurationIssue(
  configuration: WebSearchConfiguration,
  licenseKey?: string
): WebSearchConfigurationIssue | null {
  switch (configuration.provider) {
    case 'build-in':
      return licenseKey ? null : 'chatbox-ai-sign-in'
    case 'tavily':
      return configuration.tavilyApiKey ? null : 'tavily-api-key'
    case 'bocha':
      return configuration.bochaApiKey ? null : 'bocha-api-key'
    case 'querit':
      return configuration.queritApiKey ? null : 'querit-api-key'
    case 'searxng':
      return configuration.searxngBaseUrl?.trim() ? null : 'searxng-instance'
    case 'bing':
      return null
  }
}
