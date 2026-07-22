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
          documentParser: settings.extension.documentParser
            ? {
                ...settings.extension.documentParser,
                mineru: settings.extension.documentParser.mineru
                  ? { ...settings.extension.documentParser.mineru }
                  : undefined,
              }
            : settings.extension.documentParser,
        }
      : settings.extension,
    sync: settings.sync
      ? {
          ...settings.sync,
          // Device-local sync state (which snapshot this device last saw, and
          // when it synced) must not travel with an export: a restored device
          // would inherit the old device's lastSeen identity and skip its
          // first download merge against the unchanged remote snapshot.
          lastSyncedAt: undefined,
          lastSeenEndpoint: undefined,
          lastSeenETag: undefined,
          webdav: {
            ...settings.sync.webdav,
          },
        }
      : settings.sync,
    mcp: settings.mcp
      ? {
          ...settings.mcp,
          servers: Array.isArray(settings.mcp.servers)
            ? settings.mcp.servers.map((server) => ({ ...server, transport: { ...server.transport } }))
            : settings.mcp.servers,
        }
      : settings.mcp,
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
    if (cleanedSettings.extension?.documentParser?.mineru) {
      cleanedSettings.extension.documentParser.mineru.apiToken = ''
    }
    // MCP transports routinely carry credentials — stdio env vars (API tokens)
    // and HTTP headers (Authorization) must not leave the device in an export.
    if (cleanedSettings.mcp?.servers) {
      for (const server of cleanedSettings.mcp.servers) {
        if (server.transport.type === 'stdio') {
          delete server.transport.env
        } else {
          delete server.transport.headers
        }
      }
    }
  }

  return cleanedSettings
}
