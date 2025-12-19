/** biome-ignore-all lint/suspicious/noExplicitAny: any */
/** biome-ignore-all lint/suspicious/noFallthroughSwitchClause: migrate */

import deepmerge from 'deepmerge'
import type { WritableDraft } from 'immer'
import * as defaults from 'src/shared/defaults'
import { type ProviderSettings, type Settings, SettingsSchema } from 'src/shared/types'
import { createStore, useStore } from 'zustand'
import { createJSONStorage, persist, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import platform from '@/platform'
import storage from '@/storage'

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
        version: 2,
        partialize: (state) => {
          try {
            return SettingsSchema.parse(state)
          } catch {
            return state
          }
        },
        migrate: (persisted: any, version) => {
          // merge the newly added fields in defaults.settings() into the persisted values (deep merge).
          const settings: any = deepmerge(defaults.settings(), persisted, {
            arrayMerge: (_target, source) => source,
          })

          switch (version) {
            case 0:
              // fix typo
              settings.shortcuts.inputBoxSendMessage =
                settings.shortcuts.inpubBoxSendMessage || settings.shortcuts.inputBoxSendMessage
              settings.shortcuts.inputBoxSendMessageWithoutResponse =
                settings.shortcuts.inpubBoxSendMessageWithoutResponse ||
                settings.shortcuts.inputBoxSendMessageWithoutResponse
            case 1:
              if (settings.licenseKey && !settings.licenseActivationMethod) {
                settings.licenseActivationMethod = 'manual'
                settings.memorizedManualLicenseKey = settings.licenseKey
              }
            default:
              break
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

export const useProviderSettings = (providerId: string) => {
  const providers = useSettingsStore((state) => state.providers)

  const providerSettings = providers?.[providerId]

  const setProviderSettings = (
    val: Partial<ProviderSettings> | ((prev: ProviderSettings | undefined) => Partial<ProviderSettings>)
  ) => {
    settingsStore.setState((currentSettings) => {
      const currentProviderSettings = currentSettings.providers?.[providerId] || {}
      const newProviderSettings = typeof val === 'function' ? val(currentProviderSettings) : val

      return {
        providers: {
          ...(currentSettings.providers || {}),
          [providerId]: {
            ...currentProviderSettings,
            ...newProviderSettings,
          },
        },
      }
    })
  }

  return {
    providerSettings,
    setProviderSettings,
  }
}
