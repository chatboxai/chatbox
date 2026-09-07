import deepmerge from 'deepmerge'
import { createDefaultSettings, getDefaultDocumentParser, type SettingsHostDefaults } from './settings-defaults'
import { type Settings, SettingsSchema } from './settings-schema'

export const SETTINGS_PERSIST_VERSION = 6

export interface PersistedSettingsEnvelope {
  settings: unknown
  version: number
}

export function decodePersistedSettings(value: unknown): PersistedSettingsEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { __version = 0, ...settings } = value as Record<string, unknown> & { __version?: unknown }
  return {
    settings,
    version: typeof __version === 'number' && Number.isFinite(__version) ? __version : 0,
  }
}

export function encodePersistedSettings(settings: Settings): Settings & { __version: number } {
  return {
    ...settings,
    __version: SETTINGS_PERSIST_VERSION,
  }
}

/**
 * Preserves the cumulative migration semantics previously owned by Zustand
 * persist. Every older integer version receives all later migrations.
 */
export function migrateSettings(persisted: unknown, version: number, host: SettingsHostDefaults): Settings {
  const settings = deepmerge<Record<string, unknown>>(createDefaultSettings(), persisted ?? {}, {
    arrayMerge: (_target, source) => source,
  })

  const shouldRunMigration = (migrationVersion: number) =>
    Number.isInteger(version) && version >= 0 && version <= migrationVersion

  if (version === 0) {
    const shortcuts = settings.shortcuts as Record<string, unknown>
    shortcuts.inputBoxSendMessage = shortcuts.inpubBoxSendMessage || shortcuts.inputBoxSendMessage
    shortcuts.inputBoxSendMessageWithoutResponse =
      shortcuts.inpubBoxSendMessageWithoutResponse || shortcuts.inputBoxSendMessageWithoutResponse
  }

  if (shouldRunMigration(1) && settings.licenseKey && !settings.licenseActivationMethod) {
    settings.licenseActivationMethod = 'manual'
    settings.memorizedManualLicenseKey = settings.licenseKey
  }

  if (shouldRunMigration(2)) {
    const defaults = createDefaultSettings()
    const skills = settings.skills as Record<string, unknown> | undefined
    if (!skills) {
      settings.skills = defaults.skills
    } else if (skills.translationEnabled === undefined) {
      skills.translationEnabled = true
    }
  }

  if (shouldRunMigration(4)) {
    const extension = settings.extension as { documentParser?: { type?: string } } | undefined
    if (!host.isDesktopLike && extension?.documentParser?.type === 'none') {
      extension.documentParser.type = 'chatbox-ai'
    }
  }

  if (shouldRunMigration(5)) {
    const mcp = settings.mcp as { enabledBuiltinServers?: unknown } | undefined
    if (Array.isArray(mcp?.enabledBuiltinServers)) {
      mcp.enabledBuiltinServers = mcp.enabledBuiltinServers.filter((id) => id !== 'sequentialthinking')
    }
  }

  const extension = settings.extension as { documentParser?: { type?: string } } | undefined
  if (!extension?.documentParser) {
    settings.extension = {
      ...extension,
      documentParser: getDefaultDocumentParser(host),
    }
  }

  return SettingsSchema.parse(settings)
}
