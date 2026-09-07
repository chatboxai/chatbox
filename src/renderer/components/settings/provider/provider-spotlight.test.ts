import { getSystemProviders } from '@shared/providers'
import { ModelProviderEnum } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { FEATURED_PROVIDER_IDS } from './providerIcons'

describe('Provider Spotlight and List integration', () => {
  it('places new providers in the non-featured (More Providers) group by default', () => {
    const allProviders = getSystemProviders()
    const newProviderIds = [
      ModelProviderEnum.TencentHunyuan,
      ModelProviderEnum.XiaomiMiMo,
      ModelProviderEnum.LongCat,
      ModelProviderEnum.ZhipuGLMCodingPlan,
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
    expect(moreProviderIds).toContain('xiaomi-mimo')
    expect(moreProviderIds).toContain('longcat')
    expect(moreProviderIds).toContain('zhipu-glm-coding-plan')
  })
})
