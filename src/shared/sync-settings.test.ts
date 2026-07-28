import { describe, expect, it } from 'vitest'
import * as defaults from './defaults'
import { SettingsSchema } from './types'

describe('sync settings defaults', () => {
  it('defaults manual WebDAV sync credentials to empty values', () => {
    const settings = SettingsSchema.parse(defaults.settings())

    expect(settings.sync).toEqual({
      provider: 'webdav',
      webdav: {
        url: '',
        username: '',
        password: '',
        syncPassword: '',
      },
      lastSyncedAt: undefined,
    })
  })
})
