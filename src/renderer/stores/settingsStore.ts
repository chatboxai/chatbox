import * as defaults from '@shared/defaults'
import { type ProviderSettings, type Settings, SettingsSchema } from '@shared/types'
import type { DocumentParserConfig } from '@shared/types/settings'
import deepmerge from 'deepmerge'
import type { WritableDraft } from 'immer'
import { createStore, useStore } from 'zustand'
import { createJSONStorage, persist, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import storage from '@/storage'
import { mergeProviderSettings, type ProviderSettingsUpdate } from './providerSettings'

const log = getLogger('settings-store')

/**
 * Returns the default document parser configuration.
 * Desktop has a full Node.js environment, so local parsing is the default.
 */
export function getPlatformDefaultDocumentParser(): DocumentParserConfig {
  return { type: 'local' }
}

type Action = {
  setSettings: (nextStateOrUpdater: Partial<Settings> | ((state: WritableDraft<Settings>) => void)) => void
  getSettings: () => Settings
}

export const settingsStore = createStore<Settings & Action>()(
  subscribeWithSelector(
    persist(
      immer((set, get) => ({
        ...SettingsSchema.parse(defaults.settings()),
        setSettings: (val) => set(val),
        getSettings: () => {
          const store = get()
          return SettingsSchema.parse(store)
        },
      })),
      {
        name: 'settings',
        storage: createJSONStorage(() => ({
          getItem: async (key) => {
            const res = await storage.getItem<(Settings & { __version?: number }) | null>(key, null)
            if (res) {
              const { __version = 0, ...state } = res
              return JSON.stringify({
                state,
                version: __version,
              })
            }

            return null
          },
          setItem: async (name, value) => {
            const { state, version } = JSON.parse(value) as { state: Settings; version?: number }
            await storage.setItem(name, { ...state, __version: version || 0 })
          },
          removeItem: async (name) => await storage.removeItem(name),
        })),
        version: 4,
        partialize: (state) => {
          try {
            return SettingsSchema.parse(state)
          } catch {
            return state
          }
        },
        // biome-ignore lint/suspicious/noExplicitAny: pre-migration persisted state predates the current schema
        migrate: (persisted: any, version) => {
          // merge the newly added fields in defaults.settings() into the persisted values (deep merge).
          // biome-ignore lint/suspicious/noExplicitAny: pre-migration persisted state predates the current schema
          const settings: any = deepmerge(defaults.settings(), persisted, {
            arrayMerge: (_target, source) => source,
          })

          switch (version) {
            // biome-ignore lint/suspicious/noFallthroughSwitchClause: migrations from version N intentionally run every later step
            case 0:
              // fix typo
              settings.shortcuts.inputBoxSendMessage =
                settings.shortcuts.inpubBoxSendMessage || settings.shortcuts.inputBoxSendMessage
              settings.shortcuts.inputBoxSendMessageWithoutResponse =
                settings.shortcuts.inpubBoxSendMessageWithoutResponse ||
                settings.shortcuts.inputBoxSendMessageWithoutResponse
            // biome-ignore lint/suspicious/noFallthroughSwitchClause: migrations from version N intentionally run every later step
            case 2:
              // Add skills defaults for existing users upgrading from before skills feature
              if (!settings.skills) {
                settings.skills = defaults.settings().skills
              } else if (settings.skills.translationEnabled === undefined) {
                settings.skills.translationEnabled = true
              }
            default:
              break
          }

          // Apply platform-specific default for documentParser if not set
          if (!settings.extension?.documentParser) {
            settings.extension = {
              ...settings.extension,
              documentParser: getPlatformDefaultDocumentParser(),
            }
          }

          return SettingsSchema.parse(settings)
        },
        skipHydration: true,
      }
    )
  )
)

let _initSettingsStorePromise: Promise<Settings> | undefined
export const initSettingsStore = async () => {
  if (!_initSettingsStorePromise) {
    _initSettingsStorePromise = new Promise<Settings>((resolve) => {
      const unsub = settingsStore.persist.onFinishHydration((val) => {
        const providers = val?.providers
        const providersCount =
          providers && typeof providers === 'object' && !Array.isArray(providers) ? Object.keys(providers).length : 0
        if (providersCount === 0) {
          log.info(`[CONFIG_DEBUG] onFinishHydration: providersCount=0`)
        }
        unsub()
        resolve(val)
      })
      settingsStore.persist.rehydrate()
    })
  }

  return await _initSettingsStorePromise
}

settingsStore.subscribe((state, prevState) => {
  // 如果快捷键配置发生变化，需要重新注册快捷键
  if (state.shortcuts !== prevState.shortcuts) {
    platform.ensureShortcutConfig(state.shortcuts)
  }
  // 如果代理配置发生变化，需要重新注册代理
  if (state.proxy !== prevState.proxy) {
    platform.ensureProxyConfig({ proxy: state.proxy })
  }
  // 如果开机自启动配置发生变化，需要重新设置开机自启动
  if (Boolean(state.autoLaunch) !== Boolean(prevState.autoLaunch)) {
    platform.ensureAutoLaunch(state.autoLaunch)
  }
})

export function useSettingsStore<U>(selector: Parameters<typeof useStore<typeof settingsStore, U>>[1]) {
  return useStore<typeof settingsStore, U>(settingsStore, selector)
}

export const useLanguage = () => useSettingsStore((state) => state.language)
export const useTheme = () => useSettingsStore((state) => state.theme)
export const useMcpSettings = () => useSettingsStore((state) => state.mcp)

/** 是否已配置至少一个 AI provider（用于首次启动引导 / 空状态提示，FABLE F1/§9.4）。 */
export function hasConfiguredProvider(settings: Pick<Settings, 'providers'> = settingsStore.getState()): boolean {
  const providers = settings.providers
  return !!providers && typeof providers === 'object' && !Array.isArray(providers) && Object.keys(providers).length > 0
}

export const useHasConfiguredProvider = () => useSettingsStore((state) => hasConfiguredProvider(state))

export const useProviderSettings = (providerId: string) => {
  const providers = useSettingsStore((state) => state.providers)

  const providerSettings = providers?.[providerId]

  const setProviderSettings = (val: ProviderSettingsUpdate) => {
    settingsStore.setState((currentSettings) => {
      return mergeProviderSettings(currentSettings, providerId, val)
    })
  }

  return {
    providerSettings,
    setProviderSettings,
  }
}
