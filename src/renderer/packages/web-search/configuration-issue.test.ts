import { describe, expect, it } from 'vitest'
import { getWebSearchConfigurationIssue, type WebSearchReadinessSettings } from './configuration-issue'

function readiness(
  webSearch: WebSearchReadinessSettings['extension']['webSearch'],
  overrides: Omit<Partial<WebSearchReadinessSettings>, 'extension'> = {}
): WebSearchReadinessSettings {
  return { extension: { webSearch }, ...overrides }
}

describe('getWebSearchConfigurationIssue', () => {
  it('requires sign-in only for the built-in provider without a license', () => {
    expect(getWebSearchConfigurationIssue(readiness({ provider: 'build-in' }))).toBe('chatbox-ai-sign-in')
    expect(
      getWebSearchConfigurationIssue(readiness({ provider: 'build-in' }, { licenseKey: 'license-key' }))
    ).toBeNull()
    expect(getWebSearchConfigurationIssue(readiness({ provider: 'bing' }))).toBeNull()
  })

  it('reports missing third-party provider configuration', () => {
    expect(getWebSearchConfigurationIssue(readiness({ provider: 'tavily' }))).toBe('tavily-api-key')
    expect(getWebSearchConfigurationIssue(readiness({ provider: 'bocha' }))).toBe('bocha-api-key')
    expect(getWebSearchConfigurationIssue(readiness({ provider: 'querit' }))).toBe('querit-api-key')
    expect(getWebSearchConfigurationIssue(readiness({ provider: 'searxng', searxngBaseUrl: '  ' }))).toBe(
      'searxng-instance'
    )
    expect(getWebSearchConfigurationIssue(readiness({ provider: 'tavily', tavilyApiKey: 'tavily-key' }))).toBeNull()
  })

  it('uses the DeepSeek model provider key for DeepSeek search', () => {
    expect(getWebSearchConfigurationIssue(readiness({ provider: 'deepseek' }))).toBe('deepseek-api-key')
    expect(
      getWebSearchConfigurationIssue(readiness({ provider: 'deepseek' }, { providers: { deepseek: { apiKey: '  ' } } }))
    ).toBe('deepseek-api-key')
    expect(
      getWebSearchConfigurationIssue(
        readiness({ provider: 'deepseek' }, { providers: { deepseek: { apiKey: 'model-key' } } })
      )
    ).toBeNull()
  })

  it('checks a provider other than the selected one', () => {
    const settings = readiness({ provider: 'bing' }, { providers: { deepseek: { apiKey: 'model-key' } } })
    expect(getWebSearchConfigurationIssue(settings, 'deepseek')).toBeNull()
    expect(getWebSearchConfigurationIssue(settings, 'tavily')).toBe('tavily-api-key')
  })

  it('uses the Moonshot model provider key for Kimi search', () => {
    expect(getWebSearchConfigurationIssue(readiness({ provider: 'kimi' }))).toBe('kimi-api-key')
    expect(
      getWebSearchConfigurationIssue(readiness({ provider: 'kimi' }, { providers: { moonshot: { apiKey: '  ' } } }))
    ).toBe('kimi-api-key')
    expect(
      getWebSearchConfigurationIssue(readiness({ provider: 'kimi' }, { providers: { moonshot: { apiKey: 'kimi-key' } } }))
    ).toBeNull()
  })

  it('treats a configured fallback as covering an unusable primary provider', () => {
    const providers = { deepseek: { apiKey: 'model-key' } }
    // Kimi has no key, but DeepSeek can still run the search.
    expect(
      getWebSearchConfigurationIssue(readiness({ provider: 'kimi', fallbackProvider: 'deepseek' }, { providers }))
    ).toBeNull()
    // No fallback configured: the primary problem is reported.
    expect(getWebSearchConfigurationIssue(readiness({ provider: 'kimi' }, { providers }))).toBe('kimi-api-key')
    expect(
      getWebSearchConfigurationIssue(readiness({ provider: 'kimi', fallbackProvider: 'none' }, { providers }))
    ).toBe('kimi-api-key')
    // Both unusable: report the primary problem.
    expect(
      getWebSearchConfigurationIssue(readiness({ provider: 'kimi', fallbackProvider: 'deepseek' }))
    ).toBe('kimi-api-key')
  })
})
