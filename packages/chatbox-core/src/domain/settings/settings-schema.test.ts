import { describe, expect, it } from 'vitest'
import { ProviderSettingsSchema } from './settings-schema'

describe('provider model groups', () => {
  it('accepts saved settings without groups and retains groups when present', () => {
    const provider = { models: [{ modelId: 'model' }], excludedModels: ['hidden'] }
    expect(ProviderSettingsSchema.parse(provider)).toEqual(provider)

    const grouped = { ...provider, modelGroups: [{ id: 'basic', modelIds: ['model'] }] }
    expect(ProviderSettingsSchema.parse(JSON.parse(JSON.stringify(grouped)))).toEqual(grouped)
  })

  it('drops malformed groups without discarding the configured models', () => {
    const parsed = ProviderSettingsSchema.parse({
      models: [{ modelId: 'model' }],
      modelGroups: [{ id: 'basic', modelIds: null }],
      excludedModels: ['hidden'],
    })

    expect(parsed).toEqual({ models: [{ modelId: 'model' }], modelGroups: undefined, excludedModels: ['hidden'] })
  })
})
