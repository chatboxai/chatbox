import type { ProviderSettings, Settings } from '@shared/types'

function sanitizeProviderForExport(provider: ProviderSettings): ProviderSettings {
  const cleanedProvider = { ...provider }
  delete cleanedProvider.apiKey
  delete cleanedProvider.accessKey
  delete cleanedProvider.secretKey
  delete cleanedProvider.sessionToken
  return cleanedProvider
}

export function sanitizeSettingsForExport(settings: Settings, includeSecrets: boolean): Settings {
  const cleanedSettings: Settings = {
    ...settings,
    licenseDetail: undefined,
    licenseInstances: undefined,
    providers: settings.providers ? { ...settings.providers } : settings.providers,
    sync: {
      ...settings.sync,
      webdav: {
        ...settings.sync.webdav,
      },
    },
  }

  if (!includeSecrets) {
    delete cleanedSettings.licenseKey
    if (cleanedSettings.providers) {
      cleanedSettings.providers = Object.fromEntries(
        Object.entries(cleanedSettings.providers).map(([id, provider]) => [id, sanitizeProviderForExport(provider)])
      ) as Settings['providers']
    }
    cleanedSettings.sync.webdav.password = ''
    cleanedSettings.sync.webdav.syncPassword = ''
  }

  return cleanedSettings
}
