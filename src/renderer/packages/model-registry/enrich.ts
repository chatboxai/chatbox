import { findModelInRegistry } from '@shared/model-registry/enrich'
import type { ModelMetadata } from '@shared/model-registry/types'
import type { ProviderModelInfo } from '@shared/types'
import { getRegistrySync } from './fetch'

/**
 * Enrich a list of models with metadata from the local models.dev registry.
 * Replaces the backend API call to getProviderModelsInfo.
 *
 * Enrichment strategy:
 * - capabilities, contextWindow, maxOutput: registry data OVERWRITES existing values
 *   (these are factual data, registry is more authoritative and up-to-date)
 * - nickname: only filled when missing (user may have customized it)
 * - type: only filled when missing (embedding/rerank may be set by provider definition)
 * - labels: only filled when missing
 */
export function enrichModelsFromRegistry(models: ProviderModelInfo[], chatboxProviderId: string): ProviderModelInfo[] {
  const registryData = getRegistrySync()
  const providerRegistry = registryData[chatboxProviderId]

  if (!providerRegistry || models.length === 0) {
    return models
  }

  return models.map((model) => {
    const meta = findModelInRegistry(model.modelId, providerRegistry)
    if (!meta) return model

    return {
      ...model,
      capabilities: meta.capabilities.length > 0 ? meta.capabilities : model.capabilities,
      contextWindow: meta.contextWindow > 0 ? meta.contextWindow : model.contextWindow,
      maxOutput: meta.maxOutput > 0 ? meta.maxOutput : model.maxOutput,
      nickname: model.nickname || meta.name,
      type: model.type || meta.type,
    }
  })
}

/**
 * Get all models from the registry for a given provider.
 * Used as fallback when provider API listModels() fails.
 */
export function getProviderModelsFromRegistry(chatboxProviderId: string): ProviderModelInfo[] {
  const registryData = getRegistrySync()
  const providerRegistry = registryData[chatboxProviderId]

  if (!providerRegistry) return []

  return Object.values(providerRegistry).map(metadataToProviderModelInfo)
}

/**
 * Get recently released models from registry that are NOT in the curated list.
 * Used to show "New" models when user clicks Fetch.
 *
 * @param chatboxProviderId - The Chatbox provider ID
 * @param curatedModelIds - The curated model ID list for this provider
 * @param existingModelIds - Model IDs already in the user's list
 * @param recentMonths - How many months back to consider "recent" (default: 6)
 */
export function getDiscoveredModels(
  chatboxProviderId: string,
  curatedModelIds: string[],
  existingModelIds: string[],
  recentMonths = 6
): ProviderModelInfo[] {
  const registryData = getRegistrySync()
  const providerRegistry = registryData[chatboxProviderId]

  if (!providerRegistry) return []

  const curatedSet = new Set(curatedModelIds.map((id) => id.toLowerCase()))
  const existingSet = new Set(existingModelIds.map((id) => id.toLowerCase()))

  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - recentMonths)
  const cutoffStr = cutoffDate.toISOString().slice(0, 10) // "YYYY-MM-DD"

  return Object.values(providerRegistry)
    .filter((meta) => {
      const idLower = meta.modelId.toLowerCase()
      // Skip curated and already-existing models
      if (curatedSet.has(idLower) || existingSet.has(idLower)) return false
      // Skip deprecated models
      if (meta.status === 'deprecated') return false
      // Skip non-chat models (embedding, rerank)
      if (meta.type !== 'chat') return false
      // Only include recently released models
      if (!meta.releaseDate || meta.releaseDate < cutoffStr) return false
      return true
    })
    .map((meta) => ({
      ...metadataToProviderModelInfo(meta),
      labels: ['new'],
    }))
}

/**
 * Convert internal ModelMetadata to ProviderModelInfo.
 */
function metadataToProviderModelInfo(meta: ModelMetadata): ProviderModelInfo {
  return {
    modelId: meta.modelId,
    type: meta.type,
    nickname: meta.name,
    capabilities: [...meta.capabilities],
    contextWindow: meta.contextWindow,
    maxOutput: meta.maxOutput,
  }
}
