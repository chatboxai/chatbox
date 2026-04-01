import { describe, expect, it } from 'vitest'
import { mergeProviderSettings } from './providerSettings'

describe('mergeProviderSettings', () => {
  it('preserves sibling provider settings when updating one provider', () => {
    const result = mergeProviderSettings(
      {
        providers: {
          openai: { apiKey: 'sk-openai', apiHost: 'https://api.openai.com' },
          claude: { apiKey: 'sk-claude' },
        },
      },
      'openai',
      { apiPath: '/v1/responses' }
    )

    expect(result).toEqual({
      providers: {
        openai: {
          apiKey: 'sk-openai',
          apiHost: 'https://api.openai.com',
          apiPath: '/v1/responses',
        },
        claude: { apiKey: 'sk-claude' },
      },
    })
  })

  it('supports functional updates using the previous provider settings', () => {
    const result = mergeProviderSettings(
      {
        providers: {
          openai: {
            models: [{ modelId: 'gpt-5' }],
          },
        },
      },
      'openai',
      (prev) => ({
        models: [...(prev?.models || []), { modelId: 'o4-mini' }],
      })
    )

    expect(result.providers?.openai?.models).toEqual([{ modelId: 'gpt-5' }, { modelId: 'o4-mini' }])
  })

  it('creates a provider bucket when the provider has no existing settings', () => {
    const result = mergeProviderSettings({}, 'gemini', { apiKey: 'sk-gemini' })

    expect(result).toEqual({
      providers: {
        gemini: { apiKey: 'sk-gemini' },
      },
    })
  })
})
