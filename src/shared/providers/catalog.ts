import { isUsingOAuth } from '../oauth'
import type { PlatformType } from '../platform'
import { ModelProviderEnum, type ProviderModelInfo, type Settings } from '../types'
import { getAllProviders, isProviderAvailableOnPlatform } from './registry'

export interface ProviderCatalogProjection {
  id: string
  name: string
  description?: string
  isCustom: boolean
  configured: boolean
  runtimeSupported: boolean
  selectable: boolean
  models: ProviderModelInfo[]
}

function hasCredentials(
  settings: NonNullable<Settings['providers']>[string] | undefined,
  platform: PlatformType
): boolean {
  if (!settings) return false
  return Boolean(
    settings.apiKey?.trim() ||
      settings.accessKey?.trim() ||
      settings.secretKey?.trim() ||
      isUsingOAuth(settings, platform)
  )
}

/**
 * Host-neutral Provider projection for settings UIs.
 *
 * Catalog membership, persisted configuration, runtime support and model
 * selectability are deliberately represented as separate states.
 */
export function projectProviderCatalog(settings: Settings, platform: PlatformType): ProviderCatalogProjection[] {
  const builtins = getAllProviders().map((definition) => {
    const persisted = settings.providers?.[definition.id]
    const excluded = new Set(persisted?.excludedModels ?? [])
    const models = (persisted?.models ?? definition.defaultSettings?.models ?? []).filter(
      (model) => !excluded.has(model.modelId)
    )
    const configured =
      (definition.id === ModelProviderEnum.ChatboxAI && Boolean(settings.licenseKey?.trim())) ||
      hasCredentials(persisted, platform) ||
      Boolean(persisted?.models?.length)
    const runtimeSupported = isProviderAvailableOnPlatform(definition.id, platform)
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      isCustom: false,
      configured,
      runtimeSupported,
      selectable: configured && runtimeSupported && models.length > 0,
      models,
    }
  })

  const custom = (settings.customProviders ?? []).map((provider) => {
    const persisted = settings.providers?.[provider.id]
    const excluded = new Set(persisted?.excludedModels ?? [])
    const models = (persisted?.models ?? provider.defaultSettings?.models ?? []).filter(
      (model) => !excluded.has(model.modelId)
    )
    const configured = hasCredentials(persisted, platform) || models.length > 0
    return {
      id: provider.id,
      name: provider.name,
      description: provider.description,
      isCustom: true,
      configured,
      runtimeSupported: true,
      selectable: configured && models.length > 0,
      models,
    }
  })

  return [...builtins, ...custom]
}
