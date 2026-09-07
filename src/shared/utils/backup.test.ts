import { describe, expect, it } from 'vitest'
import type { Settings } from '../types'
import { cleanSettingsForBackup } from './backup'

function credentialSettings(): Settings {
  return {
    licenseKey: 'license-key',
    licenseDetail: { token_usage: 0 } as unknown as Settings['licenseDetail'],
    licenseInstances: { device: 'instance' },
    lastSelectedLicenseByUser: { user: 'selected-license' },
    memorizedManualLicenseKey: 'memorized-license',
    vibedropPublishKey: { email: 'user@example.com', key: 'publish-key' },
    providers: {
      provider: {
        apiKey: 'api-key',
        apiHost: 'https://example.com',
        oauth: { accessToken: 'access-token', refreshToken: 'refresh-token' },
        accessKey: 'access-key',
        secretKey: 'secret-key',
        sessionToken: 'session-token',
      },
    },
    customProviders: [
      {
        id: 'custom',
        name: 'Custom',
        type: 'openai',
        isCustom: true,
        defaultSettings: { apiKey: 'default-api-key', apiHost: 'https://custom.example.com' },
      },
    ],
    extension: {
      webSearch: {
        provider: 'tavily',
        tavilyApiKey: 'tavily-key',
        bochaApiKey: 'bocha-key',
        queritApiKey: 'querit-key',
        queritMaxResults: 5,
      },
      documentParser: { type: 'mineru', mineru: { apiToken: 'extension-mineru-token' } },
    },
    mcp: {
      enabledBuiltinServers: [],
      servers: [
        {
          id: 'stdio',
          name: 'stdio',
          enabled: true,
          protocolMode: 'auto',
          transport: { type: 'stdio', command: 'server', args: [], env: { TOKEN: 'stdio-token' } },
        },
        {
          id: 'http',
          name: 'http',
          enabled: true,
          transport: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token' } },
        },
      ],
    },
  } as unknown as Settings
}

describe('cleanSettingsForBackup', () => {
  it('removes every managed credential class when keys are excluded', () => {
    const cleaned = cleanSettingsForBackup(credentialSettings(), false)

    expect(cleaned).not.toHaveProperty('licenseKey')
    expect(cleaned).not.toHaveProperty('licenseDetail')
    expect(cleaned).not.toHaveProperty('licenseInstances')
    expect(cleaned).not.toHaveProperty('lastSelectedLicenseByUser')
    expect(cleaned).not.toHaveProperty('memorizedManualLicenseKey')
    expect(cleaned).not.toHaveProperty('vibedropPublishKey')
    expect(cleaned.providers).toEqual({ provider: { apiHost: 'https://example.com' } })
    expect(cleaned.customProviders).toEqual([
      {
        id: 'custom',
        name: 'Custom',
        type: 'openai',
        isCustom: true,
        defaultSettings: { apiHost: 'https://custom.example.com' },
      },
    ])
    expect(cleaned.extension).toEqual({
      webSearch: { provider: 'tavily', queritMaxResults: 5 },
      documentParser: { type: 'mineru' },
    })
    expect(cleaned.mcp).toEqual({
      enabledBuiltinServers: [],
      servers: [
        {
          id: 'stdio',
          name: 'stdio',
          enabled: true,
          protocolMode: 'auto',
          transport: { type: 'stdio', command: 'server', args: [] },
        },
        {
          id: 'http',
          name: 'http',
          enabled: true,
          transport: { type: 'http', url: 'https://example.com/mcp' },
        },
      ],
    })
  })

  it('keeps user-selected credentials while always dropping license runtime state', () => {
    const cleaned = cleanSettingsForBackup(credentialSettings(), true)

    expect(cleaned).toMatchObject({
      licenseKey: 'license-key',
      memorizedManualLicenseKey: 'memorized-license',
      vibedropPublishKey: { key: 'publish-key' },
      providers: { provider: { apiKey: 'api-key', oauth: { accessToken: 'access-token' } } },
      customProviders: [{ defaultSettings: { apiKey: 'default-api-key' } }],
      extension: {
        webSearch: { tavilyApiKey: 'tavily-key' },
        documentParser: { mineru: { apiToken: 'extension-mineru-token' } },
      },
      mcp: {
        servers: [
          { transport: { env: { TOKEN: 'stdio-token' } } },
          { transport: { headers: { Authorization: 'Bearer token' } } },
        ],
      },
    })
    expect(cleaned).not.toHaveProperty('licenseDetail')
    expect(cleaned).not.toHaveProperty('licenseInstances')
  })
})
