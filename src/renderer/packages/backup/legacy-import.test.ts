import type { SessionMetaRecord } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { importLegacyJsonBackup } from './legacy-import'
import type { BackupMetaStorage, BackupStorage } from './types'

class LegacyMemoryStorage implements BackupStorage {
  readonly values = new Map<string, unknown>()

  getAllKeys(): Promise<string[]> {
    return Promise.resolve(Array.from(this.values.keys()))
  }
  getItem<T>(key: string, initialValue: T): Promise<T> {
    return Promise.resolve((this.values.get(key) ?? initialValue) as T)
  }
  setItemNow<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value)
    return Promise.resolve()
  }
  removeItem(key: string): Promise<void> {
    this.values.delete(key)
    return Promise.resolve()
  }
  getBlob(): Promise<string | null> {
    return Promise.resolve(null)
  }
  setBlob(): Promise<void> {
    return Promise.resolve()
  }
  delBlob(): Promise<void> {
    return Promise.resolve()
  }
}

class LegacyMemoryMetaStorage implements BackupMetaStorage {
  readonly records = new Map<string, SessionMetaRecord>()

  getAllIncludingHidden(): Promise<SessionMetaRecord[]> {
    return Promise.resolve(Array.from(this.records.values()))
  }
  getById(id: string): Promise<SessionMetaRecord | null> {
    return Promise.resolve(this.records.get(id) ?? null)
  }
  create(record: SessionMetaRecord): Promise<void> {
    this.records.set(record.id, record)
    return Promise.resolve()
  }
  update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null> {
    const existing = this.records.get(id)
    if (!existing) return Promise.resolve(null)
    const updated = { ...existing, ...updates }
    this.records.set(id, updated)
    return Promise.resolve(updated)
  }
  delete(id: string): Promise<void> {
    this.records.delete(id)
    return Promise.resolve()
  }
}

function asJsonFile(value: unknown): File {
  return new File([JSON.stringify(value)], 'legacy.json', { type: 'application/json' })
}

describe('legacy JSON backup import', () => {
  it('imports legacy key/value data, migrates it, and creates or updates session metadata', async () => {
    const storage = new LegacyMemoryStorage()
    const metaStorage = new LegacyMemoryMetaStorage()
    metaStorage.records.set('existing', { id: 'existing', name: 'Old name', sortOrder: 1, createdAt: 1 })
    const recoverSessionList = vi.fn(() => Promise.resolve())
    const result = await importLegacyJsonBackup(
      asJsonFile({
        __exported_at: '2025-01-01T00:00:00.000Z',
        configVersion: 14,
        settings: { language: 'en' },
        'session:existing': { id: 'existing', name: 'Updated', messages: [] },
        'chat-sessions-list': [
          { id: 'existing', name: 'Updated', sortOrder: 2, createdAt: 2 },
          { id: 'new', name: 'New session' },
        ],
      }),
      {
        storage,
        metaStorage,
        recoverSessionList,
        migrateData: async (dataStore) => {
          const settings = await dataStore.getData<Record<string, unknown>>('settings', {})
          await dataStore.setData('settings', { ...settings, migrated: true })
        },
      }
    )

    expect(storage.values.get('settings')).toEqual({ language: 'en', migrated: true })
    expect(storage.values.get('configVersion')).toBeUndefined()
    expect(metaStorage.records.get('existing')?.name).toBe('Updated')
    expect(metaStorage.records.get('new')).toMatchObject({ id: 'new', name: 'New session' })
    expect(result).toEqual({ importedKeyCount: 2, importedMetaCount: 2, recoveredSessionList: false })
    expect(recoverSessionList).not.toHaveBeenCalled()
  })

  it('rebuilds metadata for older backups that only contain session keys', async () => {
    const metaStorage = new LegacyMemoryMetaStorage()
    metaStorage.records.set('old', {
      id: 'old',
      name: 'Archived recovery',
      sortOrder: 1,
      createdAt: 1,
      hidden: true,
      archivedAt: 1,
      recoveryArchived: true,
    })
    const recoverSessionList = vi.fn(() => Promise.resolve())
    const result = await importLegacyJsonBackup(
      asJsonFile({ 'session:old': { id: 'old', name: 'Old', messages: [] } }),
      {
        storage: new LegacyMemoryStorage(),
        metaStorage,
        recoverSessionList,
        migrateData: () => Promise.resolve(),
      }
    )
    expect(result.recoveredSessionList).toBe(true)
    expect(recoverSessionList).toHaveBeenCalledOnce()
    expect(metaStorage.records.get('old')?.recoveryArchived).toBeUndefined()
  })

  it('derives hasPausedToolCall from the imported session when restoring legacy metadata', async () => {
    const storage = new LegacyMemoryStorage()
    const metaStorage = new LegacyMemoryMetaStorage()
    const result = await importLegacyJsonBackup(
      asJsonFile({
        'session:paused': {
          id: 'paused',
          name: 'Paused',
          messages: [
            {
              id: 'msg-1',
              role: 'assistant',
              generating: false,
              contentParts: [
                {
                  type: 'tool-call',
                  toolCallId: 't1',
                  toolName: 'user_exec',
                  args: {},
                  state: 'paused',
                  pauseReason: { type: 'user_exec_approval', command: 'ls' },
                },
              ],
            },
          ],
        },
        'chat-sessions-list': [{ id: 'paused', name: 'Paused', sortOrder: 1, createdAt: 1 }],
      }),
      {
        storage,
        metaStorage,
        recoverSessionList: () => Promise.resolve(),
        migrateData: () => Promise.resolve(),
      }
    )

    expect(metaStorage.records.get('paused')?.hasPausedToolCall).toBe(true)
    expect(result.importedMetaCount).toBe(1)
  })

  it('rolls back earlier writes when canceled between legacy records', async () => {
    const storage = new LegacyMemoryStorage()
    storage.values.set('settings', { language: 'en' })
    const controller = new AbortController()
    const set = storage.setItemNow.bind(storage)
    vi.spyOn(storage, 'setItemNow').mockImplementation(async (key, value) => {
      await set(key, value)
      if (key === 'settings') controller.abort()
    })
    await expect(
      importLegacyJsonBackup(asJsonFile({ settings: { language: 'zh' }, 'session:new': { id: 'new', messages: [] } }), {
        storage,
        metaStorage: new LegacyMemoryMetaStorage(),
        signal: controller.signal,
        migrateData: async () => {},
        recoverSessionList: async () => {},
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(Object.fromEntries(storage.values)).toEqual({ settings: { language: 'en' } })
  })

  it('retains rollback data and reports an unsuccessful rollback', async () => {
    const storage = new LegacyMemoryStorage()
    storage.values.set('settings', { language: 'en' })
    vi.spyOn(storage, 'setItemNow').mockImplementation(async (key, value) => {
      if (key === 'settings') throw new Error('disk unavailable')
      storage.values.set(key, value)
    })
    await expect(
      importLegacyJsonBackup(asJsonFile({ settings: { language: 'zh' } }), {
        storage,
        metaStorage: new LegacyMemoryMetaStorage(),
        migrateData: async () => {},
        recoverSessionList: async () => {},
      })
    ).rejects.toThrow('rollback failed')
    expect([...storage.values.keys()].some((key) => key.startsWith('__backup_legacy:'))).toBe(true)
  })

  it('still restores values if enumerating metadata for rollback fails', async () => {
    const storage = new LegacyMemoryStorage()
    storage.values.set('settings', { language: 'en' })
    const metaStorage = new LegacyMemoryMetaStorage()
    vi.spyOn(metaStorage, 'getAllIncludingHidden')
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error('metadata unavailable'))
    vi.spyOn(metaStorage, 'create').mockRejectedValue(new Error('metadata write failed'))
    await expect(
      importLegacyJsonBackup(
        asJsonFile({ settings: { language: 'zh' }, 'chat-sessions-list': [{ id: 'new', name: 'New' }] }),
        {
          storage,
          metaStorage,
          migrateData: async () => {},
          recoverSessionList: async () => {},
        }
      )
    ).rejects.toThrow('rollback failed')
    expect(storage.values.get('settings')).toEqual({ language: 'en' })
  })

  it('rejects non-object JSON backups', async () => {
    await expect(
      importLegacyJsonBackup(asJsonFile([]), {
        storage: new LegacyMemoryStorage(),
        metaStorage: new LegacyMemoryMetaStorage(),
        recoverSessionList: () => Promise.resolve(),
        migrateData: () => Promise.resolve(),
      })
    ).rejects.toThrow('Unsupported legacy backup data format')
  })
})
