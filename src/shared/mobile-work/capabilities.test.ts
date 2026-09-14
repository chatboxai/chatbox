import { SessionSettingsSchema } from '@chatbox/core/domain/settings/settings-schema'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCAL_WORK_CAPABILITIES, resolveLocalWorkCapabilities, setLocalWorkCapability } from './capabilities'

describe('local work capability preferences', () => {
  it('defaults device services to disabled', () => {
    const settings = SessionSettingsSchema.parse({})
    expect(settings.localWorkCapabilities).toBeUndefined()
    expect(resolveLocalWorkCapabilities(settings.localWorkCapabilities)).toEqual(DEFAULT_LOCAL_WORK_CAPABILITIES)
    expect(resolveLocalWorkCapabilities([])).toEqual([])
  })
  it('preserves preferences through schema serialization and rejects invalid entries as a whole', () => {
    const settings = SessionSettingsSchema.parse({ localWorkCapabilities: ['photos', 'health'] })
    expect(SessionSettingsSchema.parse(JSON.parse(JSON.stringify(settings))).localWorkCapabilities).toEqual([
      'photos',
      'health',
    ])
    expect(
      SessionSettingsSchema.parse({ localWorkCapabilities: ['photos', 'unknown'] }).localWorkCapabilities
    ).toBeUndefined()
    expect(SessionSettingsSchema.parse({ localWorkCapabilities: true }).localWorkCapabilities).toBeUndefined()
  })
  it('toggles system services independently and deduplicates selections', () => {
    expect(setLocalWorkCapability(['photos'], 'calendar', true)).toEqual(['photos', 'calendar'])
    expect(setLocalWorkCapability(['photos', 'calendar'], 'calendar', false)).toEqual(['photos'])
    expect(resolveLocalWorkCapabilities(['photos', 'photos'])).toEqual(['photos'])
  })
})
