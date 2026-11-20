import type { PlatformType } from '../platform'
import type { BuiltinProviderBaseInfo } from '../types'
import type { ProviderDefinition, ProviderDefinitionInput } from './types'

const providerRegistry = new Map<string, ProviderDefinition>()

export function defineProvider(definition: ProviderDefinitionInput): ProviderDefinition {
  if (providerRegistry.has(definition.id)) {
    console.warn(`Provider "${definition.id}" is already registered. Overwriting.`)
  }
  providerRegistry.set(definition.id, definition)
  return definition
}

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return providerRegistry.get(id)
}

/** Display name of a provider: the custom provider's own name, or the built-in definition's name. */
export function getProviderDisplayName(
  id: string,
  customProviders?: readonly { id: string; name?: string }[]
): string | undefined {
  return customProviders?.find((provider) => provider.id === id)?.name?.trim() || providerRegistry.get(id)?.name
}

export function getAllProviders(): ProviderDefinition[] {
  return Array.from(providerRegistry.values())
}

export function hasProvider(id: string): boolean {
  return providerRegistry.has(id)
}

export function isProviderAvailableOnPlatform(id: string, platformType: PlatformType): boolean {
  const platforms = providerRegistry.get(id)?.platforms
  return !platforms || platforms.includes(platformType)
}

export function clearProviderRegistry(): void {
  providerRegistry.clear()
}

export function getSystemProviders(): BuiltinProviderBaseInfo[] {
  return getAllProviders().map((def) => ({
    id: def.id as BuiltinProviderBaseInfo['id'],
    name: def.name,
    type: def.type,
    description: def.description,
    urls: def.urls,
    defaultSettings: def.defaultSettings,
  }))
}
