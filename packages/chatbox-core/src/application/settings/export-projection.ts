import type { Settings } from '../../domain/settings'

function withoutProviderCredentials(provider: object): Record<string, unknown> {
  const cleanedProvider: Record<string, unknown> = { ...provider }
  delete cleanedProvider.apiKey
  delete cleanedProvider.oauth
  delete cleanedProvider.accessKey
  delete cleanedProvider.secretKey
  delete cleanedProvider.sessionToken
  return cleanedProvider
}

/** Project portable settings with explicit credential inclusion. */
export function projectSettingsForExport(settings: Settings, includeCredentials: boolean): Record<string, unknown> {
  const cleaned: Record<string, unknown> = { ...settings }
  delete cleaned.licenseDetail
  delete cleaned.licenseInstances
  if (!includeCredentials) {
    delete cleaned.licenseKey
    delete cleaned.lastSelectedLicenseByUser
    delete cleaned.memorizedManualLicenseKey
    delete cleaned.vibedropPublishKey
    if (settings.providers) {
      cleaned.providers = Object.fromEntries(
        Object.entries(settings.providers).map(([id, provider]) => [id, withoutProviderCredentials(provider)])
      )
    }
    if (settings.customProviders) {
      cleaned.customProviders = settings.customProviders.map((provider) => ({
        ...provider,
        defaultSettings: provider.defaultSettings
          ? withoutProviderCredentials(provider.defaultSettings)
          : provider.defaultSettings,
      }))
    }
    if (settings.extension) {
      const extension = { ...settings.extension }
      if (settings.extension.webSearch) {
        const webSearch = { ...settings.extension.webSearch }
        delete webSearch.tavilyApiKey
        delete webSearch.bochaApiKey
        delete webSearch.queritApiKey
        delete webSearch.firecrawlApiKey
        extension.webSearch = webSearch
      }
      if (settings.extension.documentParser?.mineru) {
        const documentParser = { ...settings.extension.documentParser }
        delete documentParser.mineru
        extension.documentParser = documentParser
      }
      cleaned.extension = extension
    }
    if (settings.mcp) {
      cleaned.mcp = {
        ...settings.mcp,
        oauth: undefined,
        servers: settings.mcp.servers.map((server) => {
          if (server.transport.type === 'stdio') {
            const transport = { ...server.transport }
            delete transport.env
            return { ...server, transport }
          }
          const transport = { ...server.transport }
          delete transport.headers
          return { ...server, transport }
        }),
      }
    }
  }
  return cleaned
}
