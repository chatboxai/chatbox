import { useChatboxApplication } from './application-context'
import {
  type AuthInfoStoreState,
  type LastUsedModelStoreState,
  type SettingsStoreState,
  useAuthInfoStore,
  useLastUsedModelStore,
  useSettingsStore,
} from './stores'

function requireStore<T>(store: T | undefined, name: string): T {
  if (!store) throw new Error(`ChatboxProvider application has no ${name}`)
  return store
}

export function useChatboxSettings<T>(selector: (state: SettingsStoreState) => T): T {
  const { settingsStore } = useChatboxApplication()
  return useSettingsStore(requireStore(settingsStore, 'SettingsStore'), selector)
}

export function useChatboxAuthInfo<T>(selector: (state: AuthInfoStoreState) => T): T {
  const { authInfoStore } = useChatboxApplication()
  return useAuthInfoStore(requireStore(authInfoStore, 'AuthInfoStore'), selector)
}

export function useChatboxLastUsedModel<T>(selector: (state: LastUsedModelStoreState) => T): T {
  const { lastUsedModelStore } = useChatboxApplication()
  return useLastUsedModelStore(requireStore(lastUsedModelStore, 'LastUsedModelStore'), selector)
}
