import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setStoreValue: vi.fn(async () => undefined),
}))

vi.mock('@/platform', () => ({
  default: {
    getStorageType: () => 'web',
    appLog: async () => undefined,
    setStoreValue: mocks.setStoreValue,
    getStoreValue: async () => undefined,
    delStoreValue: async () => undefined,
    getAllStoreValues: async () => ({}),
    getAllStoreKeys: async () => [],
    setAllStoreValues: async () => undefined,
    setStoreBlob: async () => undefined,
    getStoreBlob: async () => null,
    delStoreBlob: async () => undefined,
    listStoreBlobKeys: async () => [],
  },
}))

let StorageKeyGenerator: typeof import('./StoreStorage').StorageKeyGenerator
let StoreStorage: typeof import('./StoreStorage').default

beforeAll(async () => {
  ;({ StorageKeyGenerator, default: StoreStorage } = await import('./StoreStorage'))
})

beforeEach(() => {
  vi.useFakeTimers()
  mocks.setStoreValue.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('StorageKeyGenerator', () => {
  it('builds stable file uniq keys', () => {
    const file = {
      name: 'demo.txt',
      path: '/tmp/demo.txt',
      size: 123,
      lastModified: 456,
    } as File

    expect(StorageKeyGenerator.fileUniqKey(file)).toBe('file:/tmp/demo.txt-123-456')
  })

  it('falls back to file name when path is unavailable', () => {
    const file = {
      name: 'demo.txt',
      size: 123,
      lastModified: 456,
    } as File

    expect(StorageKeyGenerator.fileUniqKey(file)).toBe('file:demo.txt-123-456')
  })

  it('builds stable link uniq keys', () => {
    expect(StorageKeyGenerator.linkUniqKey('https://example.com/a')).toBe('link:https://example.com/a')
  })
})

describe('StoreStorage.flushItem', () => {
  it('immediately persists the latest debounced value', async () => {
    const storage = new StoreStorage()

    await storage.setItem('settings', { sync: { webdav: { url: 'https://dav.example.com/' } } })
    expect(mocks.setStoreValue).not.toHaveBeenCalled()

    await storage.flushItem('settings')

    expect(mocks.setStoreValue).toHaveBeenCalledTimes(1)
    expect(mocks.setStoreValue).toHaveBeenCalledWith('settings', {
      sync: { webdav: { url: 'https://dav.example.com/' } },
    })
  })
})
