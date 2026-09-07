import { describe, expect, it } from 'vitest'
import { WEB_SEARCH_PROVIDERS } from './constants'

describe('WEB_SEARCH_PROVIDERS', () => {
  it('contains all expected provider values', () => {
    const values = WEB_SEARCH_PROVIDERS.map((p) => p.value)
    expect(values).toEqual(['build-in', 'bing', 'tavily', 'bocha', 'querit', 'searxng'])
  })

  it('each provider has a non-empty label', () => {
    for (const provider of WEB_SEARCH_PROVIDERS) {
      expect(provider.label).toBeTruthy()
      expect(typeof provider.label).toBe('string')
    }
  })

  it('provider values are unique', () => {
    const values = WEB_SEARCH_PROVIDERS.map((p) => p.value)
    expect(new Set(values).size).toBe(values.length)
  })
})
