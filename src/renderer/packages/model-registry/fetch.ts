import { setRuntimeRegistry } from '@shared/model-registry/enrich'
import { MODELS_DEV_SNAPSHOT } from '@shared/model-registry/snapshot.generated'
import { transformFullResponse } from '@shared/model-registry/transform'
import type { ModelRegistryData, ModelsDevResponse } from '@shared/model-registry/types'
import platform from '@/platform'

const BLOB_KEY = 'model-registry-cache-v2'
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const FETCH_TIMEOUT_MS = 15_000 // 15 seconds
const API_URL = 'https://models.dev/api.json'

interface CacheEntry {
  data: ModelRegistryData
  timestamp: number
}

let memoryCache: ModelRegistryData | null = null
let fetchPromise: Promise<ModelRegistryData> | null = null
let registryVersion = 0
const listeners = new Set<() => void>()

function notifyListeners(): void {
  registryVersion += 1
  for (const listener of listeners) {
    listener()
  }
}

function applyRegistry(data: ModelRegistryData): ModelRegistryData {
  memoryCache = data
  setRuntimeRegistry(data)
  notifyListeners()
  return data
}

async function readBlobCache(): Promise<CacheEntry | null> {
  try {
    const cached = await platform.getStoreBlob(BLOB_KEY)
    if (!cached) return null
    return JSON.parse(cached) as CacheEntry
  } catch {
    return null
  }
}

async function writeBlobCache(data: ModelRegistryData): Promise<void> {
  try {
    const entry: CacheEntry = { data, timestamp: Date.now() }
    await platform.setStoreBlob(BLOB_KEY, JSON.stringify(entry))
  } catch {
    // storage might be unavailable or full
  }
}

function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_EXPIRY_MS
}

/**
 * Get the best available registry data synchronously.
 * Lookup chain: memory cache → build-time snapshot.
 * Blob cache is loaded asynchronously via prefetchModelRegistry() on startup.
 */
export function getRegistrySync(): ModelRegistryData {
  if (memoryCache) return memoryCache
  return MODELS_DEV_SNAPSHOT
}

/**
 * Get registry data, triggering a fetch if cache is stale.
 * Returns the best available data immediately if cache is valid.
 */
export async function getRegistry(): Promise<ModelRegistryData> {
  if (memoryCache) return memoryCache

  // Cold start: try to load from platform blob storage
  const cached = await readBlobCache()
  if (cached) {
    applyRegistry(cached.data)
    if (isCacheValid(cached)) {
      return cached.data
    }
  }

  // Cache stale or missing — fetch with fallback to sync data
  return fetchAndUpdateRegistry(cached?.data ?? MODELS_DEV_SNAPSHOT)
}

/**
 * Fetch fresh data from models.dev and update all caches.
 * Deduplicates concurrent calls.
 */
export function fetchAndUpdateRegistry(
  fallbackData: ModelRegistryData = getRegistrySync()
): Promise<ModelRegistryData> {
  if (fetchPromise) return fetchPromise

  fetchPromise = (async () => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      const response = await fetch(API_URL, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const raw = (await response.json()) as ModelsDevResponse
      const transformed = transformFullResponse(raw)
      applyRegistry(transformed)
      await writeBlobCache(transformed)
      return transformed
    } catch (error) {
      console.warn('[model-registry] Fetch failed, using fallback:', error)
      return applyRegistry(fallbackData)
    } finally {
      fetchPromise = null
    }
  })()

  return fetchPromise
}

/**
 * Prefetch registry data in the background on app startup.
 * Loads from platform blob storage first, then fetches if stale.
 */
export async function prefetchModelRegistry(): Promise<void> {
  const cached = await readBlobCache()
  if (cached) {
    applyRegistry(cached.data)
    if (isCacheValid(cached)) {
      return
    }
  }

  fetchAndUpdateRegistry(cached?.data ?? MODELS_DEV_SNAPSHOT).catch((error: unknown) => {
    console.error('[model-registry] Prefetch failed:', error)
  })
}

/**
 * Force refresh the registry data, ignoring cache.
 * Used when user explicitly requests a refresh (e.g., Fetch Models button).
 */
export async function forceRefreshRegistry(): Promise<ModelRegistryData> {
  const cached = await readBlobCache()
  return fetchAndUpdateRegistry(memoryCache ?? cached?.data ?? MODELS_DEV_SNAPSHOT)
}

export function subscribeRegistry(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getRegistryVersion(): number {
  return registryVersion
}
