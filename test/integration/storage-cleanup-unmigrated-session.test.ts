import 'fake-indexeddb/auto'
import { createSessionMetaRecord } from '@chatbox/core/application/session'
import type { Session } from '@shared/types'
import localforage from 'localforage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  blobs: new Map<string, string>(),
  storage: null as import('../../src/renderer/platform/interfaces').Storage | null,
  repository: null as import('../../src/renderer/adapters/CurrentSessionRepository').CurrentSessionRepository | null,
  meta: null as import('@chatbox/core/ports').SessionMetaRepositoryPort | null,
}))

vi.mock('@/platform', () => {
  const active = () => {
    if (!state.storage) throw new Error('No storage backend selected')
    return state.storage
  }
  return {
    default: {
      isDesktopLike: true,
      getStorageType: () => active().getStorageType(),
      getStoreValue: (key: string) => active().getStoreValue(key),
      setStoreValue: (key: string, value: unknown) => active().setStoreValue(key, value),
      delStoreValue: (key: string) => active().delStoreValue(key),
      getAllStoreKeys: () => active().getAllStoreKeys(),
      getImageGenerationStorage: () => ({
        initialize: async () => undefined,
        getTotal: async () => 0,
        getPage: async () => ({ items: [], nextCursor: null }),
      }),
    },
  }
})
vi.mock('@/storage', () => ({
  default: {
    getBlobKeys: async () => [...state.blobs.keys()],
    delBlob: async (key: string) => {
      state.blobs.delete(key)
    },
    getItem: async (_key: string, initialValue: unknown) => initialValue,
  },
}))
vi.mock('@/app/renderer-application', () => ({
  get sessionRepository() {
    return state.repository
  },
}))
vi.mock('@/stores/sessionHelpers', () => ({ getMetaStorage: async () => state.meta }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { getState: () => ({ getSettings: () => ({}) }) } }))
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))

import { CurrentSessionRepository } from '@/adapters/CurrentSessionRepository'
import { IndexedDBStorage } from '@/platform/storages'
import { cleanupOrphanedBlobs, startStartupStorageCleanup } from '@/setup/storage_clear'
import BaseStorage from '@/storage/BaseStorage'
import { IndexedDBSessionMetaStorage } from '@/storage/SessionMetaStorage'
import { IndexedDBSessionRowStore } from '@/storage/SessionRowStorage'

const preUpgrade: Session = {
  id: 'pre',
  name: 'Before the upgrade',
  messages: [
    {
      id: 'pre-user',
      role: 'user',
      timestamp: 1,
      contentParts: [{ type: 'text', text: 'see attachment' }],
      files: [{ id: 'f', name: 'a.pdf', fileType: 'application/pdf', storageKey: 'file:pre' }],
    },
  ],
}

describe('orphan cleanup with a session that is not migrated yet', () => {
  let rows: IndexedDBSessionRowStore

  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    state.storage = new IndexedDBStorage()
    await localforage.createInstance({ name: 'chatboxstore' }).clear()
    const meta = new IndexedDBSessionMetaStorage()
    await meta.initialize()
    await meta.clear()
    state.meta = meta
    rows = new IndexedDBSessionRowStore()
    state.repository = new CurrentSessionRepository({
      dataStorage: new BaseStorage(),
      metaStorage: meta,
      rowStore: rows,
    })
    await state.storage.setStoreValue('session:pre', preUpgrade)
    await meta.create(createSessionMetaRecord(preUpgrade, 0, 1))
    state.blobs.clear()
    state.blobs.set('file:pre', 'x')
    state.blobs.set('file:orphan', 'x')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps every blob on the storage-quota path and does not migrate the session', async () => {
    expect(await cleanupOrphanedBlobs()).toBe(0)
    expect([...state.blobs.keys()].sort()).toEqual(['file:orphan', 'file:pre'])
    expect(await rows.readCommit('pre')).toBeNull()
  })

  async function seedSessionWithoutMetadata() {
    await state.meta?.delete('pre')
    await state.storage?.delStoreValue('session:pre')
    const lost: Session = {
      ...preUpgrade,
      id: 'lost',
      messages: [
        {
          ...preUpgrade.messages[0],
          files: [{ id: 'lost-file', name: 'lost.pdf', fileType: 'application/pdf', storageKey: 'file:lost' }],
        },
      ],
    }
    await state.storage?.setStoreValue('session:lost', lost)
    state.blobs.clear()
    state.blobs.set('file:lost', 'x')
    state.blobs.set('file:orphan', 'x')
  }

  it('keeps a legacy attachment without metadata on the quota path and does not migrate it', async () => {
    await seedSessionWithoutMetadata()

    expect(await cleanupOrphanedBlobs()).toBe(0)
    expect([...state.blobs.keys()].sort()).toEqual(['file:lost', 'file:orphan'])
    expect(await rows.readCommit('lost')).toBeNull()
    expect(await state.meta?.getById('lost')).toBeNull()
  })

  it('keeps attachments if migration publishes metadata after the cleanup snapshot', async () => {
    await seedSessionWithoutMetadata()
    const repository = state.repository
    if (!repository) throw new Error('No session repository')
    const listIds = repository.getAllSessionIds.bind(repository)
    vi.spyOn(repository, 'getAllSessionIds').mockImplementationOnce(async () => {
      await repository.migrateSession('lost')
      return listIds()
    })

    expect(await cleanupOrphanedBlobs()).toBe(0)
    expect([...state.blobs.keys()].sort()).toEqual(['file:lost', 'file:orphan'])
    expect(await rows.readCommit('lost')).not.toBeNull()
    expect(await state.meta?.getById('lost')).not.toBeNull()
  })

  it('keeps attachments while migration has published rows but not yet metadata', async () => {
    await seedSessionWithoutMetadata()
    const repository = state.repository
    if (!repository) throw new Error('No session repository')
    const listIds = repository.getAllSessionIds.bind(repository)
    vi.spyOn(repository, 'getAllSessionIds').mockImplementationOnce(async () => {
      await repository.getSessionHeader('lost')
      return listIds()
    })

    expect(await cleanupOrphanedBlobs()).toBe(0)
    expect([...state.blobs.keys()].sort()).toEqual(['file:lost', 'file:orphan'])
    expect(await repository.requiresSessionMigration({ id: 'lost' })).toBe(false)
    expect(await state.meta?.getById('lost')).toBeNull()
  })

  it('cleans attachments of rows left behind after v1.23.5 deleted the session', async () => {
    await seedSessionWithoutMetadata()
    await state.repository?.migrateSession('lost')
    expect(await rows.readCommit('lost')).not.toBeNull()
    await state.meta?.delete('lost')
    await state.storage?.delStoreValue('session:lost')

    expect(await cleanupOrphanedBlobs()).toBe(2)
    expect(state.blobs.size).toBe(0)
  })

  it('keeps every blob on the startup path, then cleans true orphans once the session is migrated', async () => {
    startStartupStorageCleanup({
      sessionMigrationReady: Promise.resolve(true),
      schedule: (run) => {
        run()
        return () => undefined
      },
    })
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        'storage_clear: session pre has no row commit (unmigrated or missing), aborting without deleting'
      )
    )
    expect([...state.blobs.keys()].sort()).toEqual(['file:orphan', 'file:pre'])
    expect(await rows.readCommit('pre')).toBeNull()

    expect(await state.repository?.migrateSession('pre')).toBe('migrated')
    expect(await cleanupOrphanedBlobs()).toBe(1)
    expect([...state.blobs.keys()]).toEqual(['file:pre'])
  })
})
