import { describe, expect, it } from 'vitest'
import { getProviderDefinition, getSystemProviders } from '../index'
import { ezkielynaProvider } from './ezkielyna'

describe('Ezkielyna provider definition', () => {
  it('registers Ezkielyna with the OpenAI-compatible gateway defaults', () => {
    expect(getProviderDefinition('ezkielyna')).toBeDefined()
    expect(ezkielynaProvider.id).toBe('ezkielyna')
    expect(ezkielynaProvider.name).toBe('Ezkielyna')
    expect(ezkielynaProvider.defaultSettings?.apiHost).toBe('https://api.ezkielyna.store/v1')
    expect(ezkielynaProvider.urls?.website).toBe('https://ezkielyna.store')
    expect(ezkielynaProvider.urls?.apiKey).toBe('https://api.ezkielyna.store/console/token')
    expect(ezkielynaProvider.defaultSettings?.models?.map((m) => m.modelId)).toEqual([
      'deepseek-v4.1-flash',
      'deepseek-v4-pro',
      'glm-5.3',
    ])
  })

  it('appears in the system provider list', () => {
    expect(getSystemProviders().map((p) => p.id)).toContain('ezkielyna')
  })
})
