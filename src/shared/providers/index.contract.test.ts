import { describe, expect, it } from 'vitest'
import { MODELS_DEV_SNAPSHOT } from '../model-registry/snapshot.generated'
import { getModelsDevProviderId } from '../model-registry/provider-mapping'
import { getAllProviders } from './index'

describe('provider control-plane contracts', () => {
  it('registers providers with unique ids', () => {
    const ids = getAllProviders().map((provider) => provider.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps models.dev mapping aligned with provider definitions', () => {
    for (const provider of getAllProviders()) {
      if (!provider.modelsDevProviderId) continue
      expect(getModelsDevProviderId(provider.id)).toBe(provider.modelsDevProviderId)
    }
  })

  it('keeps curated model ids backed by provider defaults or registry data', () => {
    for (const provider of getAllProviders()) {
      if (!provider.curatedModelIds?.length) continue

      const supportedModelIds = new Set(
        [
          ...(provider.defaultSettings?.models?.map((model) => model.modelId) || []),
          ...Object.keys(MODELS_DEV_SNAPSHOT[provider.id] || {}),
        ].map((modelId) => modelId.toLowerCase())
      )

      for (const curatedModelId of provider.curatedModelIds) {
        expect(supportedModelIds.has(curatedModelId.toLowerCase())).toBe(true)
      }
    }
  })
})
