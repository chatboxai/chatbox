import type { Session, SessionMetaRecord, Settings } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { exportBackupArchive } from './export-backup'
import { importBackupArchive } from './import-backup'
import { BackupStorageKey, backupSessionStorageKey } from './storage-keys'
import type { BackupExportItem, BackupFile, BackupMetaStorage, BackupStorage } from './types'

class MemoryStorage implements BackupStorage {
  readonly values = new Map<string, unknown>()
  readonly blobs = new Map<string, string>()

  getAllKeys(): Promise<string[]> {
    return Promise.resolve(Array.from(this.values.keys()))
  }

  getItem<T>(key: string, initialValue: T): Promise<T> {
    return Promise.resolve((this.values.has(key) ? this.values.get(key) : initialValue) as T)
  }

  setItemNow<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value)
    return Promise.resolve()
  }

  removeItem(key: string): Promise<void> {
    this.values.delete(key)
    return Promise.resolve()
  }

  getBlob(key: string): Promise<string | null> {
    return Promise.resolve(this.blobs.get(key) ?? null)
  }

  setBlob(key: string, value: string): Promise<void> {
    this.blobs.set(key, value)
    return Promise.resolve()
  }

  delBlob(key: string): Promise<void> {
    this.blobs.delete(key)
    return Promise.resolve()
  }
}

class MemoryMetaStorage implements BackupMetaStorage {
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

function combine(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function asBackupFile(bytes: Uint8Array): BackupFile {
  return {
    size: bytes.byteLength,
    readBytes: (offset, length) => Promise.resolve(bytes.slice(offset, offset + length)),
    async *chunks() {
      await Promise.resolve()
      yield bytes
    },
    text: () => Promise.reject(new Error('ZIP import must not read the file as text')),
  }
}

function createMeta(session: Session): SessionMetaRecord {
  return { id: session.id, name: session.name, sortOrder: 1, createdAt: 1 }
}

async function createArchive(
  storage: MemoryStorage,
  metaStorage: MemoryMetaStorage,
  exportItems: BackupExportItem[]
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  await exportBackupArchive({
    exportItems,
    includeKeys: exportItems.includes('key'),
    exportedAt: new Date('2026-08-31T00:00:00.000Z'),
    storage,
    metaStorage,
    application: { version: 'test', platform: 'test' },
    writeArchive: async (dataCallback) => {
      for await (const chunk of dataCallback()) chunks.push(chunk)
      return { boundedMemory: true }
    },
  })
  return combine(chunks)
}

type PromptSnapshot = NonNullable<NonNullable<Session['settings']>['sessionPromptContextSnapshot']>

function snapshot(memoryStateToken: string, content: string): PromptSnapshot {
  return {
    version: 1,
    soul: '',
    memories: [{ id: content, content, createdAt: 1 }],
    memoryEnabled: true,
    memoryStateToken,
    workspaceInstructions: '',
    workspaceDirectories: [],
    capturedAt: 1,
    scope: 'chat',
  }
}

describe('Memory state backup translation', () => {
  it('rebases conversation and thread snapshots onto the destination Global Memory token', async () => {
    const frozenSnapshot = snapshot('source-global', 'Frozen source memory')
    const session: Session = {
      id: 'conversation-only',
      name: 'Conversation only',
      messages: [],
      settings: { sessionPromptContextSnapshot: frozenSnapshot },
      threads: [
        {
          id: 'thread-1',
          name: 'Earlier thread',
          messages: [],
          createdAt: 1,
          sessionPromptContextSnapshot: frozenSnapshot,
        },
      ],
    }
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session))

    const archive = await createArchive(source, sourceMeta, ['conversations'])
    const destination = new MemoryStorage()
    destination.values.set(BackupStorageKey.Settings, {
      memoryEnabled: true,
      memoryStateToken: 'destination-global',
    })
    await importBackupArchive(asBackupFile(archive), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
      createId: () => 'conversation-only-import',
    })

    const restored = destination.values.get(backupSessionStorageKey(session.id)) as Session
    expect(restored.settings?.sessionPromptContextSnapshot).toEqual({
      ...frozenSnapshot,
      memoryStateToken: ':destination-global',
    })
    expect(restored.threads?.[0].sessionPromptContextSnapshot).toEqual({
      ...frozenSnapshot,
      memoryStateToken: ':destination-global',
    })
  })

  it('refreshes Global Memory and translates only matching snapshots in a settings and conversation restore', async () => {
    const currentSnapshot = snapshot(':source-global', 'Current source memory')
    const pendingSnapshot = snapshot(':source-stale', 'Pending source memory')
    const session: Session = {
      id: 'full-memory-state',
      name: 'Full memory state',
      messages: [],
      settings: { sessionPromptContextSnapshot: pendingSnapshot },
      threads: [
        {
          id: 'thread-1',
          name: 'Earlier thread',
          messages: [],
          createdAt: 1,
          sessionPromptContextSnapshot: currentSnapshot,
        },
      ],
    }
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    source.values.set(BackupStorageKey.Settings, { memoryEnabled: true, memoryStateToken: 'source-global' })
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session))

    const archive = await createArchive(source, sourceMeta, ['setting', 'conversations'])
    const destination = new MemoryStorage()
    await importBackupArchive(asBackupFile(archive), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
      createId: () => 'full-memory-import',
    })

    const restoredSettings = destination.values.get(BackupStorageKey.Settings) as Settings
    const restored = destination.values.get(backupSessionStorageKey(session.id)) as Session
    expect(restoredSettings.memoryStateToken).toEqual(expect.any(String))
    expect(restoredSettings.memoryStateToken).not.toBe('source-global')
    expect(restored.settings?.sessionPromptContextSnapshot).toEqual(pendingSnapshot)
    expect(restored.threads?.[0].sessionPromptContextSnapshot).toEqual({
      ...currentSnapshot,
      memoryStateToken: `:${restoredSettings.memoryStateToken}`,
    })
  })
})
