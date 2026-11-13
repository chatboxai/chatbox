import { describe, expect, it } from 'vitest'
import { getProviderDefinition, getSystemProviders } from '../index'
import { powerTokensProvider } from './powertokens'

describe('PowerTokens provider definition', () => {
  it('registers PowerTokens with the OpenAI-compatible gateway defaults', () => {
    expect(getProviderDefinition('powertokens')).toBeDefined()
    expect(powerTokensProvider.id).toBe('powertokens')
    expect(powerTokensProvider.name).toBe('PowerTokens')
    expect(powerTokensProvider.defaultSettings?.apiHost).toBe('https://api.powertokens.ai/v1')
    expect(powerTokensProvider.urls?.website).toBe('https://powertokens.ai')
    expect(powerTokensProvider.urls?.apiKey).toBe('https://powertokens.ai/api-keys')
    expect(powerTokensProvider.defaultSettings?.models?.map((m) => m.modelId)).toEqual(
      expect.arrayContaining(['glm-5.2', 'MiniMax-M3', 'deepseek-v3-2-251201'])
    )
  })

  it('appears in the system provider list', () => {
    expect(getSystemProviders().map((p) => p.id)).toContain('powertokens')
  })
})
