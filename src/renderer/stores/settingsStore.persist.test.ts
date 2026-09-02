import { settings as defaultSettings } from '@shared/defaults'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type PersistedSettings = Record<string, unknown> | null
type MockPlatformType = 'desktop' | 'web' | 'mobile'

async function loadSettingsStoreModule(
  persistedSettings: PersistedSettings = null,
  platformType: MockPlatformType = 'desktop'
) {
  vi.resetModules()

  const mockStorage = {
    getItem: vi.fn(async (key: string, initialValue: unknown) => {
      if (key === 'settings') {
        return persistedSettings
      }
      return initialValue
    }),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  }

  vi.doMock('@/platform', () => ({
    default: {
      type: platformType,
      isDesktopLike: platformType === 'desktop',
      ensureShortcutConfig: vi.fn(),
      ensureProxyConfig: vi.fn(),
      ensureAutoLaunch: vi.fn(),
      appLog: vi.fn(async () => undefined),
    },
  }))

  vi.doMock('@/storage', () => ({
    default: mockStorage,
  }))

  const settingsStoreModule = await import('./settingsStore')
  const providerSettingsModule = await import('./providerSettings')

  return {
    ...settingsStoreModule,
    ...providerSettingsModule,
    mockStorage,
  }
}

async function waitForPersistCall(assertion: () => void, attempts = 10) {
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  throw lastError
}

describe('settingsStore persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unmock('@/platform')
    vi.unmock('@/storage')
  })

  it('rehydrates persisted provider and custom provider settings', async () => {
    const persistedSettings = {
      providers: {
        openai: {
          apiKey: 'sk-openai',
          models: [{ modelId: 'gpt-5' }],
        },
      },
      customProviders: [
        {
          id: 'custom-openai',
          name: 'Custom OpenAI',
          type: 'openai',
          isCustom: true,
        },
      ],
      __version: 4,
    }

    const { initSettingsStore, settingsStore } = await loadSettingsStoreModule(persistedSettings)

    const hydrated = await initSettingsStore()

    expect(hydrated.providers?.openai?.apiKey).toBe('sk-openai')
    expect(hydrated.providers?.openai?.models).toEqual([{ modelId: 'gpt-5' }])
    expect(hydrated.customProviders).toEqual([
      {
        id: 'custom-openai',
        name: 'Custom OpenAI',
        type: 'openai',
        isCustom: true,
      },
    ])
    expect(settingsStore.getState().providers?.openai?.apiKey).toBe('sk-openai')
  })

  it('persists merged provider settings without dropping sibling providers', async () => {
    const persistedSettings = {
      providers: {
        claude: {
          apiKey: 'sk-claude',
        },
      },
      __version: 4,
    }

    const { initSettingsStore, settingsStore, mergeProviderSettings, mockStorage } =
      await loadSettingsStoreModule(persistedSettings)

    await initSettingsStore()

    settingsStore.setState((currentSettings) =>
      mergeProviderSettings(currentSettings, 'openai', {
        apiKey: 'sk-openai',
        apiHost: 'https://api.openai.com',
      })
    )

    await waitForPersistCall(() => {
      expect(mockStorage.setItem).toHaveBeenCalled()
    })

    const lastPersistCall = mockStorage.setItem.mock.calls.at(-1)
    expect(lastPersistCall).toBeDefined()
    if (!lastPersistCall) {
      throw new Error('Expected settings persistence call to exist')
    }

    const [storageKey, persistedValue] = lastPersistCall as unknown as [string, Record<string, unknown>]

    expect(storageKey).toBe('settings')
    expect(persistedValue).toMatchObject({
      providers: {
        claude: {
          apiKey: 'sk-claude',
        },
        openai: {
          apiKey: 'sk-openai',
          apiHost: 'https://api.openai.com',
        },
      },
      __version: 6,
    })
  })

  it('migrates legacy Text Only document parser to Chatbox AI on web and mobile', async () => {
    const persistedSettings = {
      extension: {
        documentParser: { type: 'none' },
      },
      __version: 4,
    }

    const webStore = await loadSettingsStoreModule(persistedSettings, 'web')
    const webSettings = await webStore.initSettingsStore()
    expect(webSettings.extension?.documentParser?.type).toBe('chatbox-ai')

    const mobileStore = await loadSettingsStoreModule(persistedSettings, 'mobile')
    const mobileSettings = await mobileStore.initSettingsStore()
    expect(mobileSettings.extension?.documentParser?.type).toBe('chatbox-ai')
  })

  it('keeps desktop default document parser local', async () => {
    const { getPlatformDefaultDocumentParser } = await loadSettingsStoreModule(null, 'desktop')

    expect(getPlatformDefaultDocumentParser()).toEqual({ type: 'local' })
  })

  it.each([
    [
      '1.19 mod+r new thread shortcut',
      2,
      {
        ...defaultSettings().shortcuts,
        messageListRefreshContext: 'mod+r',
        newPictureChat: 'mod+shift+n',
      },
    ],
    [
      '1.20 mod+r new thread shortcut',
      4,
      {
        ...defaultSettings().shortcuts,
        messageListRefreshContext: 'mod+r',
        newPictureChat: 'mod+shift+n',
      },
    ],
    [
      '1.19/1.20 mod+r new thread shortcut with current persist version',
      6,
      {
        ...defaultSettings().shortcuts,
        messageListRefreshContext: 'mod+r',
        newPictureChat: 'mod+shift+n',
      },
    ],
    [
      '1.21 missing new thread shortcut',
      4,
      (() => {
        const shortcuts: Record<string, unknown> = {
          ...defaultSettings().shortcuts,
          newPictureChat: 'mod+shift+n',
        }
        delete shortcuts.messageListRefreshContext
        return shortcuts
      })(),
    ],
    [
      '1.21 missing new thread shortcut with current persist version',
      6,
      (() => {
        const shortcuts: Record<string, unknown> = {
          ...defaultSettings().shortcuts,
          newPictureChat: 'mod+shift+n',
        }
        delete shortcuts.messageListRefreshContext
        return shortcuts
      })(),
    ],
  ])('normalizes legacy shortcut settings from %s', async (_name, version, shortcuts) => {
    const persistedSettings = {
      shortcuts,
      __version: version,
    }

    const { initSettingsStore, settingsStore } = await loadSettingsStoreModule(persistedSettings)

    const hydrated = await initSettingsStore()

    expect(hydrated.shortcuts.messageListRefreshContext).toBe('mod+shift+n')
    expect(hydrated.shortcuts.newPictureChat).toBe('')
    expect(settingsStore.getState().shortcuts.messageListRefreshContext).toBe('mod+shift+n')
    expect(settingsStore.getState().shortcuts.newPictureChat).toBe('')
  })

  it('uses Chatbox AI as the default document parser on web and mobile', async () => {
    const webStore = await loadSettingsStoreModule(null, 'web')
    expect(webStore.getPlatformDefaultDocumentParser()).toEqual({ type: 'chatbox-ai' })

    const mobileStore = await loadSettingsStoreModule(null, 'mobile')
    expect(mobileStore.getPlatformDefaultDocumentParser()).toEqual({ type: 'chatbox-ai' })
  })
})
