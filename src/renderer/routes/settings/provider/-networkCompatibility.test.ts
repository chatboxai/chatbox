import { ModelProviderEnum } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { showsNetworkCompatibility } from './-networkCompatibility'

describe('provider network compatibility switch', () => {
  it.each([
    ModelProviderEnum.OpenCodeGo,
    ModelProviderEnum.OpenCodeZen,
    ModelProviderEnum.GLM,
    ModelProviderEnum.ZhipuGLMCodingPlan,
  ])('shows %s only on web', (id) => {
    expect(showsNetworkCompatibility({ id }, 'web')).toBe(true)
    for (const platformType of ['desktop', 'mobile'] as const) {
      expect(showsNetworkCompatibility({ id }, platformType)).toBe(false)
    }
  })

  it.each(['web', 'desktop', 'mobile'] as const)('shows custom providers and Ollama on %s', (platformType) => {
    expect(showsNetworkCompatibility({ id: 'custom-provider', isCustom: true }, platformType)).toBe(true)
    expect(showsNetworkCompatibility({ id: ModelProviderEnum.Ollama }, platformType)).toBe(true)
  })

  it('hides other built-in providers', () => {
    expect(showsNetworkCompatibility({ id: ModelProviderEnum.OpenAI }, 'web')).toBe(false)
  })
})
