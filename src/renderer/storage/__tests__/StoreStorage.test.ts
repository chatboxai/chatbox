import { describe, expect, it, vi } from 'vitest'
import StoreStorage, { StorageKeyGenerator } from '../StoreStorage'

const { values } = vi.hoisted(() => ({ values: new Map<string, unknown>() }))

vi.mock('@/platform', () => ({
  default: {
    getStorageType: () => 'test',
    setStoreValue: async (key: string, value: unknown) => {
      values.set(key, value)
    },
    getStoreValue: async (key: string) => values.get(key),
  },
}))

describe('StoreStorage pending writes', () => {
  it('flushes accepted debounced settings and copilot writes before backup reads', async () => {
    const storage = new StoreStorage()
    await storage.setItem('myCopilots', [{ id: 'latest' }])
    expect(values.has('myCopilots')).toBe(false)
    await storage.flushPendingWrites()
    expect(await storage.getItem('myCopilots', [])).toEqual([{ id: 'latest' }])
  })
})

describe('StorageKeyGenerator.fileUniqKey', () => {
  it('returns the first computed key when native path becomes available later', () => {
    const file = new File(['content'], 'document.pdf', {
      type: 'application/pdf',
      lastModified: 1710000000000,
    })
    const firstKey = StorageKeyGenerator.fileUniqKey(file)

    Object.defineProperty(file, 'path', {
      value: '/tmp/document.pdf',
      configurable: true,
    })

    expect(StorageKeyGenerator.fileUniqKey(file)).toBe(firstKey)
  })

  it('uses native path when it is available before the first key computation', () => {
    const file = new File(['content'], 'document.pdf', {
      type: 'application/pdf',
      lastModified: 1710000000000,
    })
    Object.defineProperty(file, 'path', {
      value: '/tmp/document.pdf',
      configurable: true,
    })

    expect(StorageKeyGenerator.fileUniqKey(file)).toBe(`file:/tmp/document.pdf-${file.size}-${file.lastModified}`)
  })
})
