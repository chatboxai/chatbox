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
    memorizedManualLicenseKey: 'memorized-license-secret',
    lastSelectedLicenseByUser: { 'alice@example.com': 'selected-license-secret' },
    providers: {
      openai: {
        apiKey: 'sk-secret',
        accessKey: 'access-secret',
        secretKey: 'secret-key',
        sessionToken: 'session-token',
        apiHost: 'https://api.example.com',
        oauth: {
          accessToken: 'oauth-access-secret',
          refreshToken: 'oauth-refresh-secret',
          expiresAt: 1893456000000,
        },
        activeAuthMode: 'oauth',
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
    extension: {
      ...defaults.settings().extension,
      webSearch: {
        ...defaults.settings().extension.webSearch,
        provider: 'tavily',
        tavilyApiKey: 'tavily-secret',
        bochaApiKey: 'bocha-secret',
        queritApiKey: 'querit-secret',
      },
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
      activeAuthMode: 'oauth',
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

  it('removes nested OAuth credentials when key export is not selected', () => {
    const settings = settingsWithSecrets()
    const sanitized = sanitizeSettingsForExport(settings, false)

    expect(sanitized.providers?.openai?.oauth).toBeUndefined()
    // The original settings object must keep its credentials untouched.
    expect(settings.providers?.openai?.oauth?.accessToken).toBe('oauth-access-secret')
    expect(settings.providers?.openai?.oauth?.refreshToken).toBe('oauth-refresh-secret')
  })

  it('removes remembered and per-account license keys when key export is not selected', () => {
    const sanitized = sanitizeSettingsForExport(settingsWithSecrets(), false)

    expect(sanitized.memorizedManualLicenseKey).toBeUndefined()
    expect(sanitized.lastSelectedLicenseByUser).toBeUndefined()
  })

  it('removes web search API keys when key export is not selected', () => {
    const settings = settingsWithSecrets()
    const sanitized = sanitizeSettingsForExport(settings, false)

    expect(sanitized.extension.webSearch.provider).toBe('tavily')
    expect(sanitized.extension.webSearch.tavilyApiKey).toBeUndefined()
    expect(sanitized.extension.webSearch.bochaApiKey).toBeUndefined()
    expect(sanitized.extension.webSearch.queritApiKey).toBeUndefined()
    // The original settings object must keep its keys untouched.
    expect(settings.extension.webSearch.tavilyApiKey).toBe('tavily-secret')
    expect(settings.extension.webSearch.bochaApiKey).toBe('bocha-secret')
    expect(settings.extension.webSearch.queritApiKey).toBe('querit-secret')
  })

  it('keeps WebDAV and provider secrets when key export is selected', () => {
    const sanitized = sanitizeSettingsForExport(settingsWithSecrets(), true)

    expect(sanitized.licenseKey).toBe('license-secret')
    expect(sanitized.memorizedManualLicenseKey).toBe('memorized-license-secret')
    expect(sanitized.lastSelectedLicenseByUser).toEqual({ 'alice@example.com': 'selected-license-secret' })
    expect(sanitized.providers?.openai?.apiKey).toBe('sk-secret')
    expect(sanitized.providers?.openai?.oauth?.accessToken).toBe('oauth-access-secret')
    expect(sanitized.providers?.openai?.oauth?.refreshToken).toBe('oauth-refresh-secret')
    expect(sanitized.extension.webSearch.tavilyApiKey).toBe('tavily-secret')
    expect(sanitized.extension.webSearch.bochaApiKey).toBe('bocha-secret')
    expect(sanitized.extension.webSearch.queritApiKey).toBe('querit-secret')
    expect(sanitized.sync.webdav.password).toBe('dav-secret')
    expect(sanitized.sync.webdav.syncPassword).toBe('sync-secret')
    expect(sanitized.licenseDetail).toBeUndefined()
    expect(sanitized.licenseInstances).toBeUndefined()
  })

  it('does not crash on settings persisted before sync and extension fields existed', () => {
    // Raw storage from older app versions lacks these objects entirely; the
    // export path casts without schema parsing, so sanitize must cope.
    const legacy = {
      ...defaults.settings(),
      licenseKey: 'license-secret',
      providers: {
        openai: {
          apiKey: 'sk-secret',
          apiHost: 'https://api.example.com',
        },
      },
      sync: undefined,
      extension: undefined,
    } as unknown as Settings

    const sanitized = sanitizeSettingsForExport(legacy, false)

    expect(sanitized.licenseKey).toBeUndefined()
    expect(sanitized.providers?.openai).toEqual({ apiHost: 'https://api.example.com' })
    expect(sanitized.sync).toBeUndefined()
    expect(sanitized.extension).toBeUndefined()
  })
})
