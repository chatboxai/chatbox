import { InMemorySessionRowStore } from '@chatbox/core/testing'
import { stageLegacySessionRows } from '@chatbox/core/backup'
import type { SessionMetaRecord } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { importLegacyJsonBackup } from './legacy-import'
import type { BackupMetaStorage, BackupStorage } from './types'

class LegacyMemoryStorage implements BackupStorage {
  readonly values = new Map<string, unknown>()
  readonly sessions = new InMemorySessionRowStore()

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
        sessions: storage.sessions,
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
    expect(storage.values.has('session:existing')).toBe(false)
    expect(await storage.sessions.readCommit('existing')).toMatchObject({ record: { rowFormatVersion: 3 } })
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
        sessions: new InMemorySessionRowStore(),
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
        sessions: storage.sessions,
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
        sessions: storage.sessions,
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
        sessions: storage.sessions,
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
          sessions: storage.sessions,
          metaStorage,
          migrateData: async () => {},
          recoverSessionList: async () => {},
        }
      )
    ).rejects.toThrow('rollback failed')
    expect(storage.values.get('settings')).toEqual({ language: 'en' })
  })

  it('restores published rows when metadata publication fails', async () => {
    const storage = new LegacyMemoryStorage()
    const original = await stageLegacySessionRows(storage.sessions, { id: 'old', name: 'Original', messages: [] })
    await original.publish()
    await original.dispose()
    const revision = await storage.sessions.getRevision('old')
    const metaStorage = new LegacyMemoryMetaStorage()
    vi.spyOn(metaStorage, 'create').mockRejectedValueOnce(new Error('metadata failed'))
    const genericGet = vi.spyOn(storage, 'getItem')
    const genericSet = vi.spyOn(storage, 'setItemNow')
    await expect(
      importLegacyJsonBackup(
        asJsonFile({
          'session:old': { id: 'old', name: 'Imported', messages: [] },
          'session:new': { id: 'new', name: 'New', messages: [] },
          'chat-sessions-list': [{ id: 'old', name: 'Imported' }],
        }),
        {
          storage,
          sessions: storage.sessions,
          metaStorage,
          migrateData: async () => {},
          recoverSessionList: async () => {},
        }
      )
    ).rejects.toThrow('metadata failed')
    expect(await storage.sessions.readCommit('old')).toMatchObject({ record: { name: 'Original' } })
    expect(await storage.sessions.getRevision('old')).toBe(revision)
    expect(await storage.sessions.readCommit('new')).toBeNull()
    expect(genericGet.mock.calls.some(([key]) => key.startsWith('session:'))).toBe(false)
    expect(genericSet.mock.calls.some(([key]) => key.startsWith('session:'))).toBe(false)
  })

  it.each([0, 200_000])(
    'rejects malformed message fields before publication with %i padding bytes',
    async (padding) => {
      const storage = new LegacyMemoryStorage()
      const original = await stageLegacySessionRows(storage.sessions, { id: 'old', name: 'Original', messages: [] })
      await original.publish()
      await original.dispose()
      const revision = await storage.sessions.getRevision('old')
      storage.values.set('settings', { language: 'en' })
      const metaStorage = new LegacyMemoryMetaStorage()
      const begin = storage.sessions.beginBackupRestore.bind(storage.sessions)
      const publish = vi.fn()
      const dispose = vi.fn()
      vi.spyOn(storage.sessions, 'beginBackupRestore').mockImplementation(async (...args) => {
        const candidate = await begin(...args)
        return {
          ...candidate,
          publish: async (signal) => {
            publish()
            await candidate.publish(signal)
          },
          dispose: async () => {
            dispose()
            await candidate.dispose()
          },
        }
      })
      await expect(
        importLegacyJsonBackup(
          asJsonFile({
            settings: { language: 'zh' },
            'session:old': { id: 'old', name: 'Replacement', messages: [] },
            'session:bad': {
              id: 'bad',
              name: 'Invalid message',
              messages: [
                { id: 'broken', role: 'user', contentParts: [{ type: 'text', text: 99 }], extra: 'x'.repeat(padding) },
              ],
            },
          }),
          {
            storage,
            sessions: storage.sessions,
            metaStorage,
            migrateData: async () => {},
            recoverSessionList: async () => {},
          }
        )
      ).rejects.toThrow('invalid message broken')
      expect(publish).not.toHaveBeenCalled()
      expect(dispose).toHaveBeenCalledOnce()
      expect(await storage.sessions.readCommit('old')).toMatchObject({ record: { name: 'Original' } })
      expect(await storage.sessions.getRevision('old')).toBe(revision)
      expect(await storage.sessions.readCommit('bad')).toBeNull()
      expect(metaStorage.records.size).toBe(0)
      expect(storage.values.get('settings')).toEqual({ language: 'en' })
    }
  )

  it('validates every session identity before publishing rows or settings', async () => {
    const storage = new LegacyMemoryStorage()
    const begin = vi.spyOn(storage.sessions, 'beginBackupRestore')
    await expect(
      importLegacyJsonBackup(
        asJsonFile({
          settings: { language: 'zh' },
          'session:good': { id: 'good', name: 'Good', messages: [] },
          'session:bad': { id: 'other', name: 'Bad', messages: [] },
        }),
        {
          storage,
          sessions: storage.sessions,
          metaStorage: new LegacyMemoryMetaStorage(),
          migrateData: async () => {},
          recoverSessionList: async () => {},
        }
      )
    ).rejects.toThrow('identity mismatch')
    expect(begin).not.toHaveBeenCalled()
    expect(storage.values.size).toBe(0)
  })

  it('rolls back a published row when cancellation arrives before the next session', async () => {
    const storage = new LegacyMemoryStorage()
    const controller = new AbortController()
    const begin = storage.sessions.beginBackupRestore.bind(storage.sessions)
    vi.spyOn(storage.sessions, 'beginBackupRestore').mockImplementation(async (...args) => {
      const candidate = await begin(...args)
      return {
        ...candidate,
        publish: async (signal) => {
          await candidate.publish(signal)
          controller.abort()
        },
      }
    })
    await expect(
      importLegacyJsonBackup(
        asJsonFile({
          'session:first': { id: 'first', name: 'First', messages: [] },
          'session:second': { id: 'second', name: 'Second', messages: [] },
        }),
        {
          storage,
          sessions: storage.sessions,
          signal: controller.signal,
          metaStorage: new LegacyMemoryMetaStorage(),
          migrateData: async () => {},
          recoverSessionList: async () => {},
        }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(await storage.sessions.readCommit('first')).toBeNull()
    expect(await storage.sessions.readCommit('second')).toBeNull()
  })

  it('rejects non-object JSON backups', async () => {
    await expect(
      importLegacyJsonBackup(asJsonFile([]), {
        storage: new LegacyMemoryStorage(),
        sessions: new InMemorySessionRowStore(),
        metaStorage: new LegacyMemoryMetaStorage(),
        recoverSessionList: () => Promise.resolve(),
        migrateData: () => Promise.resolve(),
      })
    ).rejects.toThrow('Unsupported legacy backup data format')
  })
})
