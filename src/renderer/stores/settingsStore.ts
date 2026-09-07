import { getDefaultDocumentParser } from '@chatbox/core/domain/settings'
import {
  type SettingsStoreState,
  selectLanguage,
  selectMcpSettings,
  selectTheme,
  useSettingsStore as useSharedSettingsStore,
} from '@chatbox/react/stores'
import type { DocumentParserConfig } from '@shared/types/settings'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { settingsService, settingsStore } from '@/settings-runtime'
import { mergeProviderSettings, type ProviderSettingsUpdate } from './providerSettings'

const log = getLogger('settings-store')

export { settingsService, settingsStore }

/**
 * Returns the same host-specific parser default used by Settings migrations.
 */
export function getPlatformDefaultDocumentParser(): DocumentParserConfig {
  return getDefaultDocumentParser({ isDesktopLike: platform.isDesktopLike })
}

let initSettingsStorePromise: Promise<SettingsStoreState> | null = null

export function initSettingsStore() {
  if (!initSettingsStorePromise) {
    initSettingsStorePromise = settingsStore
      .getState()
      .hydrate()
      .then(() => {
        const state = settingsStore.getState()
        const providers = state.providers
        const providersCount =
          providers && typeof providers === 'object' && !Array.isArray(providers) ? Object.keys(providers).length : 0
        if (providersCount === 0) {
          log.info('[CONFIG_DEBUG] onFinishHydration: providersCount=0')
        }
        return state
      })
  }
  return initSettingsStorePromise
}

export function useSettingsStore<U>(selector: (state: SettingsStoreState) => U): U {
  return useSharedSettingsStore(settingsStore, selector)
}

export const useLanguage = () => useSettingsStore(selectLanguage)
export const useTheme = () => useSettingsStore(selectTheme)
export const useMcpSettings = () => useSettingsStore(selectMcpSettings)

export function useProviderSettings(providerId: string) {
  const providers = useSettingsStore((state) => state.providers)
  const providerSettings = providers?.[providerId]

  const setProviderSettings = (value: ProviderSettingsUpdate) => {
    settingsStore.setState((currentSettings) => mergeProviderSettings(currentSettings, providerId, value))
  }

  return {
    providerSettings,
    setProviderSettings,
  }
}
