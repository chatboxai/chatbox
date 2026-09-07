import { describe, expect, it } from 'vitest'
import { getWebSearchConfigurationIssue } from './configuration-issue'

describe('getWebSearchConfigurationIssue', () => {
  it('requires sign-in only for the built-in provider without a license', () => {
    expect(getWebSearchConfigurationIssue({ provider: 'build-in' })).toBe('chatbox-ai-sign-in')
    expect(getWebSearchConfigurationIssue({ provider: 'build-in' }, 'license-key')).toBeNull()
    expect(getWebSearchConfigurationIssue({ provider: 'bing' })).toBeNull()
  })

  it('reports missing third-party provider configuration', () => {
    expect(getWebSearchConfigurationIssue({ provider: 'tavily' })).toBe('tavily-api-key')
    expect(getWebSearchConfigurationIssue({ provider: 'bocha' })).toBe('bocha-api-key')
    expect(getWebSearchConfigurationIssue({ provider: 'querit' })).toBe('querit-api-key')
    expect(getWebSearchConfigurationIssue({ provider: 'searxng', searxngBaseUrl: '  ' })).toBe('searxng-instance')
  })
})
