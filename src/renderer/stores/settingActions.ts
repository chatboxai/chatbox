import { getDefaultStore } from 'jotai'
import { ModelProvider, ModelProviderEnum, Settings } from '../../shared/types'
import * as atoms from './atoms'

export function modify(update: Partial<Settings>) {
  const store = getDefaultStore()
  store.set(atoms.settingsAtom, (settings) => ({
    ...settings,
    ...update,
  }))
}

export function needEditSetting() {
  const store = getDefaultStore()
  const settings = store.get(atoms.settingsAtom)

  // 激活了chatbox ai
  if (settings.licenseKey) {
    return false
  }

  if (settings.providers && Object.keys(settings.providers).length > 0) {
    const providers = settings.providers
    const keys = Object.keys(settings.providers)
    // 有任何一个供应商配置了api key
    if (keys.filter((key) => !!providers[key].apiKey).length > 0) {
      return false
    }
    // Ollama / LMStudio/ custom provider 配置了至少一个模型
    if (
      keys.filter(
        (key) =>
          (key === ModelProviderEnum.Ollama || key === ModelProviderEnum.LMStudio || key.startsWith('custom-provider')) &&
          providers[key].models?.length
      ).length > 0
    ) {
      return false
    }
  }
  return true
}

export function getLanguage() {
  const store = getDefaultStore()
  const settings = store.get(atoms.settingsAtom)
  return settings.language
}

export function getProxy() {
  const store = getDefaultStore()
  const settings = store.get(atoms.settingsAtom)
  return settings.proxy
}

export function getLicenseKey() {
  const store = getDefaultStore()
  const settings = store.get(atoms.settingsAtom)
  return settings.licenseKey
}

export function getRemoteConfig() {
  const store = getDefaultStore()
  return store.get(atoms.remoteConfigAtom)
}

export function getSettings() {
  const store = getDefaultStore()
  return store.get(atoms.settingsAtom)
}

export function getAutoGenerateTitle() {
  const store = getDefaultStore()
  return store.get(atoms.autoGenerateTitleAtom)
}

export function setModelProvider(provider: ModelProvider) {
  const store = getDefaultStore()
  store.set(atoms.settingsAtom, (settings) => ({
    ...settings,
    aiProvider: provider,
  }))
}

export function getExtensionSettings() {
  const store = getDefaultStore()
  return store.get(atoms.settingsAtom).extension
}

export function createCustomProvider() {
  // TODO: Uncomment and implement this function
  // const newCustomProvider: CustomProvider = {
  //   id: `custom-provider-${Date.now()}`,
  //   name: 'Untitled',
  //   api: 'openai',
  //   host: 'https://api.openai.com/v1',
  //   path: '/chat/completions',
  //   key: '',
  //   model: 'gpt-4o',
  // }
  // const store = getDefaultStore()
  // store.set(atoms.settingsAtom, (settings) => ({
  //   ...settings,
  //   aiProvider: ModelProviderEnum.Custom,
  //   selectedCustomProviderId: newCustomProvider.id,
  //   customProviders: [newCustomProvider, ...settings.customProviders],
  // }))
}
