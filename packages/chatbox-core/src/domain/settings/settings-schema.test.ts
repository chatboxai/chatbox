import { describe, expect, it } from 'vitest'
import { createDefaultSettings } from './settings-defaults'
import { ProviderSettingsSchema, SettingsSchema } from './settings-schema'

describe('compaction retention settings', () => {
  const schema = SettingsSchema.pick({ compactionRetainRatio: true })

  it('defaults old settings and new installations to 0%', () => {
    expect(schema.parse({}).compactionRetainRatio).toBe(0)
    expect(createDefaultSettings().compactionRetainRatio).toBe(0)
  })

  it.each([0, 0.16, 0.5])('preserves a saved ratio of %s', (compactionRetainRatio) => {
    const saved = JSON.parse(JSON.stringify({ compactionRetainRatio }))
    expect(schema.parse(saved).compactionRetainRatio).toBe(compactionRetainRatio)
  })

  it.each([-1, 0.51, NaN, Infinity, '16%', null])('falls back for an invalid ratio: %s', (compactionRetainRatio) => {
    expect(schema.parse({ compactionRetainRatio }).compactionRetainRatio).toBe(0)
  })
})

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
