import { describe, expect, it } from 'vitest'
import * as defaults from './defaults'
import { SettingsSchema } from './types'

describe('sync settings defaults', () => {
  it('defaults WebDAV sync to disabled and keeps credentials empty', () => {
    const settings = SettingsSchema.parse(defaults.settings())

    expect(settings.sync).toEqual({
      enabled: false,
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
