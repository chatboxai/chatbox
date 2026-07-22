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
  // The export path reads raw storage via a type cast, and settings persisted
  // before the sync/extension fields existed are not re-normalized until the
  // next settings save — so both objects can be absent at runtime despite
  // being required in the schema. Spread and redact defensively.
  const cleanedSettings: Settings = {
    ...settings,
    licenseDetail: undefined,
    licenseInstances: undefined,
    providers: settings.providers ? { ...settings.providers } : settings.providers,
    extension: settings.extension
      ? {
          ...settings.extension,
          webSearch: {
            ...settings.extension.webSearch,
          },
        }
      : settings.extension,
    sync: settings.sync
      ? {
          ...settings.sync,
          webdav: {
            ...settings.sync.webdav,
          },
        }
      : settings.sync,
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
    if (cleanedSettings.extension?.webSearch) {
      delete cleanedSettings.extension.webSearch.tavilyApiKey
      delete cleanedSettings.extension.webSearch.bochaApiKey
      delete cleanedSettings.extension.webSearch.queritApiKey
    }
    if (cleanedSettings.sync?.webdav) {
      cleanedSettings.sync.webdav.password = ''
      cleanedSettings.sync.webdav.syncPassword = ''
    }
  }

  return cleanedSettings
}
