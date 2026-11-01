import { describe, expect, it } from 'vitest'
import { findModelInRegistry } from '../../model-registry/enrich'
import { getModelsDevProviderId } from '../../model-registry/provider-mapping'
import { MODELS_DEV_SNAPSHOT } from '../../model-registry/snapshot.generated'
import { getProviderDefinition, getSystemProviders } from '../index'
import { longCatProvider } from './longcat'
import { tencentHunyuanProvider } from './tencent-hunyuan'
import { xiaomiMiMoProvider } from './xiaomi-mimo'
import { volcEngineCodingPlanProvider } from './volcengine-coding-plan'
import { zhipuGLMCodingPlanProvider } from './zhipu-glm-coding-plan'

describe('Tencent Hunyuan / Xiaomi MiMo / LongCat / GLM Coding Plan definitions', () => {
  it('registers Tencent Hunyuan provider with correct default settings', () => {
    expect(getProviderDefinition('tencent-hunyuan')).toBeDefined()
    expect(tencentHunyuanProvider.id).toBe('tencent-hunyuan')
    expect(tencentHunyuanProvider.defaultSettings?.apiHost).toBe('https://api.hunyuan.cloud.tencent.com/v1')
    expect(tencentHunyuanProvider.defaultSettings?.models?.length).toBeGreaterThan(0)
  })

  it('registers Xiaomi MiMo provider with correct default settings', () => {
    expect(getProviderDefinition('xiaomi-mimo')).toBeDefined()
    expect(xiaomiMiMoProvider.id).toBe('xiaomi-mimo')
    expect(xiaomiMiMoProvider.defaultSettings?.apiHost).toBe('https://api.xiaomimimo.com/v1')
    expect(xiaomiMiMoProvider.defaultSettings?.models?.map((m) => m.modelId)).toContain('mimo-v2.5-pro')
  })

  it('registers LongCat provider with correct default settings', () => {
    expect(getProviderDefinition('longcat')).toBeDefined()
    expect(longCatProvider.id).toBe('longcat')
    expect(longCatProvider.defaultSettings?.apiHost).toBe('https://api.longcat.chat/openai/v1')
    expect(longCatProvider.defaultSettings?.models?.map((m) => m.modelId)).toContain('LongCat-2.0')
  })

  it('registers Zhipu GLM Coding Plan provider with correct default settings', () => {
    expect(getProviderDefinition('zhipu-glm-coding-plan')).toBeDefined()
    expect(zhipuGLMCodingPlanProvider.id).toBe('zhipu-glm-coding-plan')
    expect(zhipuGLMCodingPlanProvider.defaultSettings?.apiHost).toBe('https://open.bigmodel.cn/api/coding/paas/v4')
    expect(zhipuGLMCodingPlanProvider.defaultSettings?.models?.map((m) => m.modelId)).toContain('glm-5.3')
  })

  it('keeps GLM Coding Plan out of models.dev enrichment', () => {
    // The zhipuai catalog has no glm-5.3 / glm-5-turbo entry, and
    // findModelInRegistry() treats '.' and '-' as prefix boundaries, so both ids
    // collapse onto 'glm-5' and would have their contextWindow overwritten
    // (1M -> 200K) once a models.dev refresh lands. This provider ships its own
    // verified catalog instead, so it must stay out of the mapping.
    expect(zhipuGLMCodingPlanProvider.modelsDevProviderId).toBeUndefined()
    expect(getModelsDevProviderId(zhipuGLMCodingPlanProvider.id)).toBeUndefined()

    const zhipuCatalog = MODELS_DEV_SNAPSHOT['chatglm-6b']
    expect(findModelInRegistry('glm-5.3', zhipuCatalog)?.modelId).toBe('glm-5')
    expect(findModelInRegistry('glm-5-turbo', zhipuCatalog)?.modelId).toBe('glm-5')
  })

  it('registers VolcEngine Coding Plan provider with correct default settings', () => {
    expect(getProviderDefinition('volcengine-coding-plan')).toBeDefined()
    expect(volcEngineCodingPlanProvider.id).toBe('volcengine-coding-plan')
    // The Coding Plan endpoint is /api/coding/v3; the pay-as-you-go /api/v3
    // endpoint rejects Coding Plan API keys.
    expect(volcEngineCodingPlanProvider.defaultSettings?.apiHost).toBe(
      'https://ark.cn-beijing.volces.com/api/coding/v3'
    )
    expect(volcEngineCodingPlanProvider.defaultSettings?.apiPath).toBe('/chat/completions')
    expect(volcEngineCodingPlanProvider.defaultSettings?.models?.map((m) => m.modelId)).toContain(
      'ark-code-latest'
    )
    expect(volcEngineCodingPlanProvider.defaultSettings?.models?.map((m) => m.modelId)).toContain(
      'doubao-seed-2.1-pro'
    )
  })

  it('keeps VolcEngine Coding Plan out of models.dev enrichment', () => {
    // models.dev has no catalog for the Coding Plan model names, and
    // findModelInRegistry() collapses suffixed ids onto unrelated entries, so
    // this provider ships its own verified catalog instead of enrichment.
    expect(volcEngineCodingPlanProvider.modelsDevProviderId).toBeUndefined()
    expect(getModelsDevProviderId(volcEngineCodingPlanProvider.id)).toBeUndefined()
  })

  it('includes all four new providers in system providers list', () => {
    const systemProviderIds = getSystemProviders().map((p) => p.id)
    expect(systemProviderIds).toContain('tencent-hunyuan')
    expect(systemProviderIds).toContain('xiaomi-mimo')
    expect(systemProviderIds).toContain('longcat')
    expect(systemProviderIds).toContain('zhipu-glm-coding-plan')
    expect(systemProviderIds).toContain('volcengine-coding-plan')
  })
})
