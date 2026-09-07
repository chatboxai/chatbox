import type { BlobStoragePort } from '@chatbox/core/ports'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CurrentBlobStorage, type CurrentBlobStorageBackend } from './CurrentBlobStorage'

function createHarness() {
  const values = new Map<string, string>()
  const backend: CurrentBlobStorageBackend = {
    getBlob: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    setBlob: vi.fn((key: string, value: string) => {
      values.set(key, value)
      return Promise.resolve()
    }),
    delBlob: vi.fn((key: string) => {
      values.delete(key)
      return Promise.resolve()
    }),
    getBlobKeys: vi.fn(() => Promise.resolve([...values.keys()])),
  }
  const storage: BlobStoragePort = new CurrentBlobStorage(backend)

  return {
    backend,
    storage,
    values,
  }
}

describe('CurrentBlobStorage contract', () => {
  let harness: ReturnType<typeof createHarness>

  beforeEach(() => {
    harness = createHarness()
  })

  test('round-trips values without changing storage keys or contents', async () => {
    await harness.storage.set('file:session-1:message-1', 'parsed content')

    await expect(harness.storage.get('file:session-1:message-1')).resolves.toBe('parsed content')
    expect(harness.backend.setBlob).toHaveBeenCalledWith('file:session-1:message-1', 'parsed content')
  })

  test('returns null for missing blobs', async () => {
    await expect(harness.storage.get('missing')).resolves.toBeNull()
  })

  test('deletes values through the current blob backend', async () => {
    harness.values.set('picture:one', 'image-data')

    await harness.storage.remove('picture:one')

    expect(harness.values.has('picture:one')).toBe(false)
    expect(harness.backend.delBlob).toHaveBeenCalledWith('picture:one')
  })

  test('lists the current blob key space unchanged', async () => {
    harness.values.set('file:one', 'one')
    harness.values.set('link:https://example.com', 'two')

    await expect(harness.storage.keys()).resolves.toEqual(['file:one', 'link:https://example.com'])
  })
})
