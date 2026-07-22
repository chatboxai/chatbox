import type { ProviderSettings, Settings } from '@shared/types'

function sanitizeProviderForExport(provider: ProviderSettings): ProviderSettings {
  const cleanedProvider = { ...provider }
  delete cleanedProvider.apiKey
  delete cleanedProvider.accessKey
  delete cleanedProvider.secretKey
  delete cleanedProvider.sessionToken
  // Nested OAuth credentials (accessToken / refreshToken / extra tokens) are
  // just as sensitive as API keys; the whole object must not be exported.
  delete cleanedProvider.oauth
  return cleanedProvider
}

export function sanitizeSettingsForExport(settings: Settings, includeSecrets: boolean): Settings {
  const cleanedSettings: Settings = {
    ...settings,
    licenseDetail: undefined,
    licenseInstances: undefined,
    providers: settings.providers ? { ...settings.providers } : settings.providers,
    extension: {
      ...settings.extension,
      webSearch: {
        ...settings.extension.webSearch,
      },
    },
    sync: {
      ...settings.sync,
      webdav: {
        ...settings.sync.webdav,
      },
    },
  }

  if (!includeSecrets) {
    delete cleanedSettings.licenseKey
    // License keys remembered for the UI or selected per account are still
    // credentials even though the active licenseKey lives elsewhere.
    delete cleanedSettings.memorizedManualLicenseKey
    delete cleanedSettings.lastSelectedLicenseByUser
    if (cleanedSettings.providers) {
      cleanedSettings.providers = Object.fromEntries(
        Object.entries(cleanedSettings.providers).map(([id, provider]) => [id, sanitizeProviderForExport(provider)])
      ) as Settings['providers']
    }
    delete cleanedSettings.extension.webSearch.tavilyApiKey
    delete cleanedSettings.extension.webSearch.bochaApiKey
    delete cleanedSettings.extension.webSearch.queritApiKey
    cleanedSettings.sync.webdav.password = ''
    cleanedSettings.sync.webdav.syncPassword = ''
  }

  return cleanedSettings
}
