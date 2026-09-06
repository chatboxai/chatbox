import { describe, expect, it } from 'vitest'
import { SettingsSchema } from './settings-schema'

const cacheSettings = SettingsSchema.pick({ anthropicCacheTtl: true })

describe('Anthropic cache settings', () => {
  it('keeps five-minute caching for existing settings', () => {
    expect(cacheSettings.parse({})).toEqual({ anthropicCacheTtl: '5m' })
  })

  it('persists both supported TTL values', () => {
    for (const anthropicCacheTtl of ['5m', '1h']) {
      expect(cacheSettings.parse(JSON.parse(JSON.stringify({ anthropicCacheTtl })))).toEqual({ anthropicCacheTtl })
    }
  })

  it('falls back safely for corrupt or unsupported TTL values', () => {
    for (const anthropicCacheTtl of ['24h', null, 3600, {}]) {
      expect(cacheSettings.parse({ anthropicCacheTtl })).toEqual({ anthropicCacheTtl: '5m' })
    }
  })
})
