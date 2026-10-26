import { describe, expect, test } from 'vitest'
import { mergeSettingsWithDefaults } from './merge-settings'
import { createDefaultSettings } from './settings-defaults'
import {
  decodePersistedSettings,
  encodePersistedSettings,
  migrateSettings,
  SETTINGS_PERSIST_VERSION,
} from './settings-migrations'

describe('settings migrations', () => {
  test('preserves the historical envelope and current version', () => {
    const settings = createDefaultSettings()
    const encoded = encodePersistedSettings(settings)

    expect(encoded.__version).toBe(SETTINGS_PERSIST_VERSION)
    expect(decodePersistedSettings(encoded)).toEqual({
      settings,
      version: SETTINGS_PERSIST_VERSION,
    })
  })

  test('applies all fallthrough migrations from version 0 without losing credentials', () => {
    const defaults = createDefaultSettings()
    const migrated = migrateSettings(
      {
        ...defaults,
        licenseKey: 'license-legacy',
        providers: {
          openai: {
            apiKey: 'sk-openai',
            oauth: {
              accessToken: 'oauth-access',
              refreshToken: 'oauth-refresh',
            },
          },
        },
        shortcuts: {
          ...defaults.shortcuts,
          inputBoxSendMessage: '',
          inputBoxSendMessageWithoutResponse: '',
          inpubBoxSendMessage: 'Command+Enter',
          inpubBoxSendMessageWithoutResponse: 'Ctrl+Shift+Enter',
        },
        skills: undefined,
        extension: {
          ...defaults.extension,
          documentParser: { type: 'none' },
        },
      },
      0,
      { isDesktopLike: false }
    )

    expect(migrated.shortcuts.inputBoxSendMessage).toBe('Command+Enter')
    expect(migrated.shortcuts.inputBoxSendMessageWithoutResponse).toBe('Ctrl+Shift+Enter')
    expect(migrated.licenseActivationMethod).toBe('manual')
    expect(migrated.memorizedManualLicenseKey).toBe('license-legacy')
    expect(migrated.providers?.openai).toMatchObject({
      apiKey: 'sk-openai',
      oauth: {
        accessToken: 'oauth-access',
        refreshToken: 'oauth-refresh',
      },
    })
    expect(migrated.skills.translationEnabled).toBe(true)
    expect(migrated.extension.documentParser).toEqual({ type: 'chatbox-ai' })
  })

  test('moves the version 7 default compaction threshold to the current default and keeps chosen values', () => {
    const defaults = createDefaultSettings()
    expect(
      migrateSettings({ ...defaults, compactionThreshold: 0.6 }, 7, { isDesktopLike: true }).compactionThreshold
    ).toBe(defaults.compactionThreshold)
    expect(
      migrateSettings({ ...defaults, compactionThreshold: 0.6000000000000001 }, 7, { isDesktopLike: true })
        .compactionThreshold
    ).toBe(defaults.compactionThreshold)
    for (const chosen of [0.4, 0.5, 0.85, 0.9]) {
      expect(
        migrateSettings({ ...defaults, compactionThreshold: chosen }, 7, { isDesktopLike: true }).compactionThreshold
      ).toBe(chosen)
    }
    const { compactionThreshold: _omitted, ...withoutThreshold } = defaults
    expect(migrateSettings(withoutThreshold, 7, { isDesktopLike: true }).compactionThreshold).toBe(0.75)
  })

  test('uses the desktop parser default when an older snapshot has no parser', () => {
    const migrated = migrateSettings(createDefaultSettings(), 4, {
      isDesktopLike: true,
    })

    expect(migrated.extension.documentParser).toEqual({ type: 'local' })
  })

  test('filters unavailable built-in state without changing custom servers', () => {
    const defaults = createDefaultSettings()
    const migrated = migrateSettings(
      {
        ...defaults,
        mcp: {
          enabledBuiltinServers: ['fetch', 'sequentialthinking', 'context7'],
          servers: [
            {
              id: 'sequentialthinking',
              name: 'Custom Sequential Thinking',
              enabled: true,
              transport: {
                type: 'http',
                url: 'https://example.com/sequentialthinking',
              },
            },
          ],
        },
      },
      5,
      { isDesktopLike: true }
    )

    expect(migrated.mcp.enabledBuiltinServers).toEqual(['fetch', 'context7'])
    expect(migrated.mcp.servers).toEqual([
      expect.objectContaining({
        id: 'sequentialthinking',
        name: 'Custom Sequential Thinking',
      }),
    ])
  })

  test.each([0, 5, 6])('removes built-in EdgeOne from version %i without changing custom servers', (version) => {
    const defaults = createDefaultSettings()
    const customServer = {
      id: 'edgeone-pages',
      name: 'Custom publishing server',
      enabled: true,
      transport: { type: 'http' as const, url: 'https://example.com/mcp' },
    }
    const migrated = migrateSettings(
      {
        ...defaults,
        mcp: {
          enabledBuiltinServers: ['fetch', 'edgeone-pages', 'arxiv', 'context7'],
          servers: [customServer],
        },
      },
      version,
      { isDesktopLike: true }
    )

    expect(migrated.mcp.enabledBuiltinServers).toEqual(['fetch', 'arxiv', 'context7'])
    expect(migrated.mcp.servers).toEqual([expect.objectContaining(customServer)])
  })

  test.each([0, 1, 2, 3, 4, 5, 6, 7])('keeps the complete version %i snapshot compatible', (version) => {
    const defaults = createDefaultSettings()
    const persisted = {
      ...defaults,
      licenseKey: 'license-all-fields',
      providers: {
        openai: {
          apiKey: 'sk-all-fields',
          oauth: {
            accessToken: 'oauth-all-fields',
            refreshToken: 'refresh-all-fields',
          },
        },
      },
      customProviders: [
        {
          id: 'custom-provider',
          name: 'Custom Provider',
          type: 'openai',
          isCustom: true,
        },
      ],
      shortcuts: {
        ...defaults.shortcuts,
        inputBoxSendMessage: '',
        inputBoxSendMessageWithoutResponse: '',
        inpubBoxSendMessage: 'Command+Enter',
        inpubBoxSendMessageWithoutResponse: 'Ctrl+Shift+Enter',
      },
      extension: {
        ...defaults.extension,
        documentParser: { type: 'none' },
      },
    }

    const actual =
      version === SETTINGS_PERSIST_VERSION
        ? mergeSettingsWithDefaults(persisted)
        : migrateSettings(persisted, version, { isDesktopLike: false })

    const expected = {
      ...defaults,
      licenseKey: 'license-all-fields',
      licenseActivationMethod: version <= 1 ? 'manual' : undefined,
      memorizedManualLicenseKey: version <= 1 ? 'license-all-fields' : undefined,
      providers: persisted.providers,
      customProviders: persisted.customProviders,
      shortcuts: {
        ...defaults.shortcuts,
        inputBoxSendMessage: version === 0 ? 'Command+Enter' : '',
        inputBoxSendMessageWithoutResponse: version === 0 ? 'Ctrl+Shift+Enter' : '',
      },
      extension: {
        ...defaults.extension,
        documentParser: version <= 4 ? { type: 'chatbox-ai' } : { type: 'none' },
      },
    }

    expect(actual).toEqual(expected)
  })
})
