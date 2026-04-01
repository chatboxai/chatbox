import { findModelInRegistry } from '@shared/model-registry/enrich'
import { extractContextWindows } from '@shared/model-registry/transform'
import type { ModelRegistryData } from '@shared/model-registry/types'
import { useSyncExternalStore } from 'react'
import { enrichModelsFromRegistry, getDiscoveredModels, getProviderModelsFromRegistry } from './enrich'
import {
  fetchAndUpdateRegistry,
  forceRefreshRegistry,
  getRegistry,
  getRegistrySync,
  getRegistryVersion,
  prefetchModelRegistry,
  subscribeRegistry,
} from './fetch'

// ===== New API =====

export {
  // Fetch & cache
  getRegistrySync,
  getRegistry,
  fetchAndUpdateRegistry,
  forceRefreshRegistry,
  prefetchModelRegistry,
  // Enrichment
  enrichModelsFromRegistry,
  getProviderModelsFromRegistry,
  getDiscoveredModels,
}

// ===== Backward-compatible API (replaces model-context) =====

const DEFAULT_CONTEXT_WINDOW = 96_000

/**
 * Find context window by exact or prefix match in a flattened context window map.
 * Uses the same boundary-aware prefix matching as findModelInRegistry.
 */
function findContextWindow(modelId: string, data: Record<string, number>): number | null {
  const normalized = modelId.toLowerCase()

  // Exact match (case-insensitive)
  for (const key of Object.keys(data)) {
    if (key.toLowerCase() === normalized) {
      return data[key]
    }
  }

  // Prefix match with boundary check
  let bestKey = ''
  let bestValue: number | null = null
  for (const key of Object.keys(data)) {
    const keyLower = key.toLowerCase()
    if (normalized.startsWith(keyLower) && key.length > bestKey.length) {
      const nextChar = normalized[keyLower.length]
      if (nextChar === undefined || nextChar === '-' || nextChar === ':' || nextChar === '/' || nextChar === '@') {
        bestKey = key
        bestValue = data[key]
      }
    }
  }
  return bestValue
}

function getProviderContextWindow(modelId: string, providerId: string, registry: ModelRegistryData): number | null {
  const providerRegistry = registry[providerId]
  if (!providerRegistry) return null

  const meta = findModelInRegistry(modelId, providerRegistry)
  return meta && meta.contextWindow > 0 ? meta.contextWindow : null
}

/**
 * Get model context window synchronously.
 * Backward-compatible with the old model-context module.
 */
export function getModelContextWindowSync(modelId: string): number | null {
  if (!modelId) return null
  return findContextWindow(modelId, extractContextWindows(getRegistrySync()))
}

export function getProviderModelContextWindowSync(providerId: string, modelId: string): number | null {
  if (!providerId || !modelId) return null
  return getProviderContextWindow(modelId, providerId, getRegistrySync())
}

/**
 * Get model context window asynchronously (triggers fetch if cache stale).
 * Backward-compatible with the old model-context module.
 */
export async function getModelContextWindow(modelId: string): Promise<number | null> {
  if (!modelId) return null
  return findContextWindow(modelId, extractContextWindows(await getRegistry()))
}

export async function getProviderModelContextWindow(providerId: string, modelId: string): Promise<number | null> {
  if (!providerId || !modelId) return null
  return getProviderContextWindow(modelId, providerId, await getRegistry())
}

/**
 * Get model context window with a default fallback.
 * Backward-compatible with the old model-context module.
 */
export function getModelContextWindowWithDefault(modelId: string): number {
  return getModelContextWindowSync(modelId) ?? DEFAULT_CONTEXT_WINDOW
}

/**
 * Prefetch model context data in the background.
 * Backward-compatible with the old model-context module.
 */
export function prefetchModelContextData(): void {
  prefetchModelRegistry().catch((error: unknown) => {
    console.error('[model-registry] Prefetch failed:', error)
  })
}

export function useModelRegistryVersion(): number {
  return useSyncExternalStore(subscribeRegistry, getRegistryVersion, getRegistryVersion)
}

export { DEFAULT_CONTEXT_WINDOW }
