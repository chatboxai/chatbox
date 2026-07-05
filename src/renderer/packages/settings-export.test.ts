import * as defaults from '@shared/defaults'
import type { Settings } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { sanitizeSettingsForExport } from './settings-export'

function settingsWithSecrets(): Settings {
  return {
    ...defaults.settings(),
    licenseKey: 'license-secret',
    licenseDetail: { plan: 'pro' } as unknown as Settings['licenseDetail'],
    licenseInstances: { 'license-secret': 'device-1' },
    providers: {
      openai: {
        apiKey: 'sk-secret',
        accessKey: 'access-secret',
        secretKey: 'secret-key',
        sessionToken: 'session-token',
        apiHost: 'https://api.example.com',
      },
    },
    sync: {
      enabled: true,
      provider: 'webdav',
      webdav: {
        url: 'https://dav.example.com/files/me/',
        username: 'alice',
        password: 'dav-secret',
        syncPassword: 'sync-secret',
      },
      lastSyncedAt: '2026-07-05T00:00:00.000Z',
    },
  }
}

describe('sanitizeSettingsForExport', () => {
  it('removes WebDAV and provider secrets when key export is not selected', () => {
    const settings = settingsWithSecrets()
    const sanitized = sanitizeSettingsForExport(settings, false)

    expect(sanitized.licenseKey).toBeUndefined()
    expect(sanitized.licenseDetail).toBeUndefined()
    expect(sanitized.licenseInstances).toBeUndefined()
    expect(sanitized.providers?.openai).toEqual({
      apiHost: 'https://api.example.com',
    })
    expect(sanitized.sync.webdav).toEqual({
      url: 'https://dav.example.com/files/me/',
      username: 'alice',
      password: '',
      syncPassword: '',
    })
    expect(settings.sync.webdav.password).toBe('dav-secret')
    expect(settings.sync.webdav.syncPassword).toBe('sync-secret')
  })

  it('keeps WebDAV and provider secrets when key export is selected', () => {
    const sanitized = sanitizeSettingsForExport(settingsWithSecrets(), true)

    expect(sanitized.licenseKey).toBe('license-secret')
    expect(sanitized.providers?.openai?.apiKey).toBe('sk-secret')
    expect(sanitized.sync.webdav.password).toBe('dav-secret')
    expect(sanitized.sync.webdav.syncPassword).toBe('sync-secret')
    expect(sanitized.licenseDetail).toBeUndefined()
    expect(sanitized.licenseInstances).toBeUndefined()
  })
})
