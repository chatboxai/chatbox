import { getSystemProviders } from '@shared/providers'
import { ModelProviderEnum } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { FEATURED_PROVIDER_IDS } from './providerIcons'

describe('Provider Spotlight and List integration', () => {
  it.each([ModelProviderEnum.XiaomiMiMo, ModelProviderEnum.MiniMax, ModelProviderEnum.GLM])(
    'places %s in the default list and Popular group',
    (id) => {
      expect(getSystemProviders().some((provider) => provider.id === id)).toBe(true)
      expect(FEATURED_PROVIDER_IDS).toContain(id)
    }
  )

  it('resolves saved GLM provider IDs with the current display name', () => {
    const provider = getSystemProviders().find((provider) => provider.id === 'chatglm-6b')
    expect(provider?.id).toBe(ModelProviderEnum.GLM)
    expect(provider?.name).toBe('GLM')
  })

  it('keeps non-featured providers in the More Providers group', () => {
    const allProviders = getSystemProviders()
    const newProviderIds = [
      ModelProviderEnum.TencentHunyuan,
      ModelProviderEnum.LongCat,
      ModelProviderEnum.ZhipuGLMCodingPlan,
      ModelProviderEnum.Ionet,
    ]

    for (const id of newProviderIds) {
      expect(allProviders.some((p) => p.id === id)).toBe(true)
      expect(FEATURED_PROVIDER_IDS.includes(id)).toBe(false)
    }

    const moreProviders = allProviders.filter(
      (p) => !FEATURED_PROVIDER_IDS.includes(p.id as ModelProviderEnum) && p.id !== ModelProviderEnum.ChatboxAI
    )

    const moreProviderIds = moreProviders.map((p) => p.id)
    expect(moreProviderIds).toContain('tencent-hunyuan')
    expect(moreProviderIds).toContain('longcat')
    expect(moreProviderIds).toContain('zhipu-glm-coding-plan')
    expect(moreProviderIds).toContain('ionet')
  })
})
