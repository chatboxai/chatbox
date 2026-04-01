import { MODELS_DEV_SNAPSHOT } from './snapshot.generated'
import type { ModelMetadata, ModelRegistryData, ProviderModelRegistry } from './types'

/**
 * Default registry data source (build-time snapshot).
 * Can be overridden at runtime by the renderer layer with fresher data.
 */
let runtimeRegistry: ModelRegistryData | null = null

/**
 * Set the runtime registry data source.
 * Called by the renderer layer after fetching fresh data from models.dev.
 * This allows the shared-layer enrichment to use the freshest available data.
 */
export function setRuntimeRegistry(registry: ModelRegistryData): void {
  runtimeRegistry = registry
}

/**
 * Get the best available registry data.
 * Priority: runtime registry (injected by renderer) → build-time snapshot.
 *
 * The renderer layer calls setRuntimeRegistry() on startup after loading
 * from platform-specific blob storage (file on desktop, IndexedDB on web/mobile).
 */
function getRegistry(): ModelRegistryData {
  if (runtimeRegistry) return runtimeRegistry
  return MODELS_DEV_SNAPSHOT
}

/**
 * Find a model in the registry by exact match or prefix match.
 * Prefix matching handles cases like fine-tuned model IDs (e.g., "gpt-4o:ft-xxx").
 */
export function findModelInRegistry(modelId: string, registry: ProviderModelRegistry): ModelMetadata | undefined {
  const normalized = modelId.toLowerCase()

  // Exact match (case-insensitive)
  for (const [key, meta] of Object.entries(registry)) {
    if (key.toLowerCase() === normalized) {
      return meta
    }
  }

  // Prefix match: find the longest registry key that is a prefix of modelId
  // Requires a boundary character (-, :, .) after the prefix to avoid
  // e.g. "gpt-4" matching "gpt-4o"
  let bestMatch: ModelMetadata | undefined
  let bestLength = 0
  for (const [key, meta] of Object.entries(registry)) {
    const keyLower = key.toLowerCase()
    if (normalized.startsWith(keyLower) && key.length > bestLength) {
      const nextChar = normalized[keyLower.length]
      if (nextChar === undefined || nextChar === '-' || nextChar === ':' || nextChar === '.') {
        bestMatch = meta
        bestLength = key.length
      }
    }
  }

  return bestMatch
}

/**
 * Enrich a single ProviderModelInfo with metadata from the registry.
 * Used by getModelConfig() to ensure model instances have correct capabilities.
 *
 * Enrichment strategy:
 * - capabilities, contextWindow, maxOutput: registry data OVERWRITES existing values
 *   (these are factual data, registry is more authoritative and up-to-date)
 * - nickname: only filled when missing (user may have customized it)
 * - type: only filled when missing
 */
export function enrichModelFromRegistry<T extends { modelId: string; [key: string]: unknown }>(
  model: T,
  chatboxProviderId: string
): T {
  const registry = getRegistry()
  const providerRegistry = registry[chatboxProviderId]
  if (!providerRegistry) return model

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
}
