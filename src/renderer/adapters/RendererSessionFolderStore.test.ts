import { beforeEach, describe, expect, test, vi } from 'vitest'

const { values } = vi.hoisted(() => ({ values: new Map<string, unknown>() }))

vi.mock('@/storage', () => ({
  default: {
    getItemRaw: (key: string) => Promise.resolve(values.get(key)),
    setItemNow: (key: string, value: unknown) => {
      values.set(key, value)
      return Promise.resolve()
    },
  },
  nonSessionStorageKey: (key: string) => key,
  StorageKey: { SessionFolders: 'session-folders' },
}))

import { rendererSessionFolderStore } from './RendererSessionFolderStore'

describe('rendererSessionFolderStore', () => {
  beforeEach(() => values.clear())

  test('keeps fields from newer versions through a load and save', async () => {
    values.set('session-folders', [{ id: 'a', name: 'A', source: { kind: 'future' } }])

    const folders = await rendererSessionFolderStore.load()
    await rendererSessionFolderStore.save(folders.map((folder) => ({ ...folder, name: 'Renamed' })))

    expect(values.get('session-folders')).toEqual([{ id: 'a', name: 'Renamed', source: { kind: 'future' } }])
  })

  test('reads a missing or malformed list as no folders', async () => {
    expect(await rendererSessionFolderStore.load()).toEqual([])
    values.set('session-folders', { id: 'a' })
    expect(await rendererSessionFolderStore.load()).toEqual([])
  })
})
