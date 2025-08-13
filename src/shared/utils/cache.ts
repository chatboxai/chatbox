// Cross-platform cache implementation that works in both renderer and main processes
export interface CacheItem<T> {
  value: T
  expireAt: number
}

// Memory cache to store ongoing promises and prevent duplicate calls
const pendingPromises = new Map<string, Promise<unknown>>()

// Memory-only cache that expires on restart
const memoryCache = new Map<string, CacheItem<unknown>>()

// Cross-platform storage adapter
class CrossPlatformStorage {
  private name: string
  private memoryFallback = new Map<string, string>()

  constructor(name: string) {
    this.name = name
  }

  async getItem(key: string): Promise<string | null> {
    // In renderer process with localforage
    if (typeof window !== 'undefined' && 'localforage' in window) {
      try {
        const localforage = (await import('localforage')).default
        const store = localforage.createInstance({ name: this.name })
        return await store.getItem<string>(key)
      } catch (error) {
        console.error('Error accessing localforage:', error)
        return this.memoryFallback.get(key) || null
      }
    }

    // In main process or fallback
    return this.memoryFallback.get(key) || null
  }

  async setItem(key: string, value: string): Promise<void> {
    // In renderer process with localforage
    if (typeof window !== 'undefined' && 'localforage' in window) {
      try {
        const localforage = (await import('localforage')).default
        const store = localforage.createInstance({ name: this.name })
        await store.setItem(key, value)
        return
      } catch (error) {
        console.error('Error accessing localforage:', error)
        this.memoryFallback.set(key, value)
        return
      }
    }

    // In main process or fallback
    this.memoryFallback.set(key, value)
  }

  async removeItem(key: string): Promise<void> {
    // In renderer process with localforage
    if (typeof window !== 'undefined' && 'localforage' in window) {
      try {
        const localforage = (await import('localforage')).default
        const store = localforage.createInstance({ name: this.name })
        await store.removeItem(key)
        return
      } catch (error) {
        console.error('Error accessing localforage:', error)
        this.memoryFallback.delete(key)
        return
      }
    }

    // In main process or fallback
    this.memoryFallback.delete(key)
  }
}

export const store = new CrossPlatformStorage('chatboxcache')

async function cacheWithStorage<T>(
  key: string,
  getter: () => Promise<T>,
  options: {
    ttl: number // 缓存过期时间，单位为毫秒
    refreshFallbackToCache?: boolean // 如果刷新时获取新值失败，是否从缓存中继续使用过期的旧值
    memoryOnly?: boolean // 是否仅使用内存缓存
  }
): Promise<T> {
  let cache: CacheItem<T> | null = null

  if (options.memoryOnly) {
    cache = (memoryCache.get(key) as CacheItem<T> | undefined) || null
  } else {
    const cachedStr = await store.getItem(key)
    if (cachedStr) {
      try {
        cache = JSON.parse(cachedStr)
      } catch (e) {
        console.error(`Error parsing cache for key ${key}:`, e)
      }
    }
  }

  if (cache && cache.expireAt > Date.now()) {
    return cache.value
  }

  // Check if there's already a pending promise for this key
  const existingPromise = pendingPromises.get(key) as Promise<T> | undefined
  if (existingPromise) {
    return existingPromise
  }

  // Create new promise and store it to prevent duplicate calls
  const promise = (async () => {
    try {
      const newValue = await getter()
      const newCache: CacheItem<T> = {
        value: newValue,
        expireAt: Date.now() + options.ttl,
      }

      if (options.memoryOnly) {
        memoryCache.set(key, newCache)
      } else {
        await store.setItem(key, JSON.stringify(newCache))
      }

      return newValue
    } catch (e) {
      if (options.refreshFallbackToCache && cache) {
        return cache.value
      }
      throw e
    } finally {
      // Remove the promise from pending map when done
      pendingPromises.delete(key)
    }
  })()

  pendingPromises.set(key, promise)
  return promise
}

export async function cache<T>(
  key: string,
  getter: () => Promise<T>,
  options: {
    ttl: number // 缓存过期时间，单位为毫秒
    refreshFallbackToCache?: boolean // 如果刷新时获取新值失败，是否从缓存中继续使用过期的旧值
    memoryOnly?: boolean // 是否仅使用内存缓存
  }
): Promise<T> {
  return cacheWithStorage(key, getter, options)
}
