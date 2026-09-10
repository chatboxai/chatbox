import type { Settings } from '../types'

function withoutProviderCredentials(provider: object): Record<string, unknown> {
  const cleanedProvider: Record<string, unknown> = { ...provider }
  delete cleanedProvider.apiKey
  delete cleanedProvider.oauth
  delete cleanedProvider.accessKey
  delete cleanedProvider.secretKey
  delete cleanedProvider.sessionToken
  return cleanedProvider
}

/**
 * Strip sensitive data from settings before writing a backup
 * (`chatbox-backup-*.zip`). License runtime state is always dropped;
 * license key and provider credentials are kept only when `includeKeys` is set.
 * Shared by the desktop/Web export (settings/general.tsx) and the native backup.
 */
export function cleanSettingsForBackup(settings: Settings, includeKeys: boolean): Record<string, unknown> {
  const cleaned: Record<string, unknown> = { ...settings }
  delete cleaned.licenseDetail
  delete cleaned.licenseInstances
  if (!includeKeys) {
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
        delete webSearch.keenableApiKey
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

export function getBackupFilename(exportedAt: Date): string {
  const year = exportedAt.getFullYear()
  const month = exportedAt.getMonth() + 1
  const day = exportedAt.getDate()
  return `chatbox-backup-${year}-${month}-${day}.zip`
}
