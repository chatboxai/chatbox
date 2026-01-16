import { getDefaultStore } from 'jotai'
import { ModelProviderEnum } from 'src/shared/types'
import * as atoms from './atoms'
import { settingsStore } from './settingsStore'

export function needEditSetting() {
  const settings = settingsStore.getState()

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
    // Bedrock 配置了 AWS 凭证
    if (
      providers[ModelProviderEnum.Bedrock]?.awsAccessKeyId &&
      providers[ModelProviderEnum.Bedrock]?.awsSecretAccessKey
    ) {
      return false
    }
    // Ollama / LMStudio/ custom provider 配置了至少一个模型
    if (
      keys.filter(
        (key) =>
          (key === ModelProviderEnum.Ollama ||
            key === ModelProviderEnum.LMStudio ||
            key.startsWith('custom-provider')) &&
          providers[key].models?.length
      ).length > 0
    ) {
      return false
    }
  }
  return true
}

export function getLanguage() {
  return settingsStore.getState().language
}

export function getProxy() {
  return settingsStore.getState().proxy
}

export function getLicenseKey() {
  return settingsStore.getState().licenseKey
}

export function getLicenseDetail() {
  return settingsStore.getState().licenseDetail
}

export function isPaid() {
  return !!getLicenseKey()
}

export function isPro() {
  return !!getLicenseKey() && !getLicenseDetail()?.name.toLowerCase().includes('lite')
}

export function getRemoteConfig() {
  const store = getDefaultStore()
  return store.get(atoms.remoteConfigAtom)
}

export function getAutoGenerateTitle() {
  return settingsStore.getState().autoGenerateTitle
}

export function getExtensionSettings() {
  return settingsStore.getState().extension
}
