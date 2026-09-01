import type { SessionMetaRecord } from '@shared/types'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { BACKUP_SESSION_SETTINGS_PATH } from './archive-layout'
import { exportBackupArchive } from './export-backup'
import { importBackupArchive } from './import-backup'
import { BackupStorageKey } from './storage-keys'
import type { BackupFile, BackupMetaStorage, BackupStorage } from './types'

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

class FailOnceStorage extends MemoryStorage {
  private shouldFail = true

  override setItemNow<T>(key: string, value: T): Promise<void> {
    if (this.shouldFail && key === BackupStorageKey.CopilotMemoryTokens) {
      this.shouldFail = false
      return super
        .setItemNow(key, value)
        .then(() => Promise.reject(new Error('Injected Copilot memory token write failure')))
    }
    return super.setItemNow(key, value)
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

const copilotMemories = {
  tutor: [{ id: 'memory-1', content: 'Learner level is B1', createdAt: 1 }],
}
const copilotMemoryOwners = [{ id: 'tutor', name: 'Tutor' }]
const copilotMemoryTokens = [{ id: 'tutor', token: 'source-token' }]

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

async function createCopilotArchive(): Promise<Uint8Array> {
  const storage = new MemoryStorage()
  storage.values.set(BackupStorageKey.CopilotMemories, copilotMemories)
  storage.values.set(BackupStorageKey.CopilotMemoryOwners, copilotMemoryOwners)
  storage.values.set(BackupStorageKey.CopilotMemoryTokens, copilotMemoryTokens)
  const chunks: Uint8Array[] = []

  await exportBackupArchive({
    exportItems: ['copilot'],
    includeKeys: false,
    exportedAt: new Date('2026-08-28T00:00:00.000Z'),
    storage,
    metaStorage: new MemoryMetaStorage(),
    application: { version: 'test', platform: 'test' },
    writeArchive: async (dataCallback) => {
      for await (const chunk of dataCallback()) chunks.push(chunk)
      return { boundedMemory: true }
    },
  })

  return combine(chunks)
}

describe('Copilot backup storage', () => {
  it('exports and imports Copilot memories through the generic key-value entry', async () => {
    const archive = await createCopilotArchive()
    const keyValueEntry = unzipSync(archive)[BACKUP_SESSION_SETTINGS_PATH]
    if (!keyValueEntry) throw new Error('Copilot backup key-value entry is missing')
    expect(JSON.parse(new TextDecoder().decode(keyValueEntry))).toEqual({
      [BackupStorageKey.CopilotMemories]: copilotMemories,
      [BackupStorageKey.CopilotMemoryOwners]: copilotMemoryOwners,
      [BackupStorageKey.CopilotMemoryTokens]: copilotMemoryTokens,
    })

    const destination = new MemoryStorage()
    await importBackupArchive(asBackupFile(archive), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
      createId: () => 'copilot-import',
    })

    expect(destination.values.get(BackupStorageKey.CopilotMemories)).toEqual(copilotMemories)
    expect(destination.values.get(BackupStorageKey.CopilotMemoryOwners)).toEqual(copilotMemoryOwners)
    const restoredTokens = destination.values.get(BackupStorageKey.CopilotMemoryTokens)
    expect(restoredTokens).toEqual([{ id: 'tutor', token: expect.any(String) }])
    expect(restoredTokens).not.toEqual(copilotMemoryTokens)
  })

  it('rolls all Copilot memory keys back when their import fails', async () => {
    const archive = await createCopilotArchive()
    const destination = new FailOnceStorage()
    const previousMemories = { existing: [{ id: 'old-memory', content: 'Keep me', createdAt: 2 }] }
    const previousOwners = [{ id: 'existing', name: 'Existing Copilot' }]
    const previousTokens = [{ id: 'existing', token: 'previous-token' }]
    destination.values.set(BackupStorageKey.CopilotMemories, previousMemories)
    destination.values.set(BackupStorageKey.CopilotMemoryOwners, previousOwners)
    destination.values.set(BackupStorageKey.CopilotMemoryTokens, previousTokens)

    await expect(
      importBackupArchive(asBackupFile(archive), {
        storage: destination,
        metaStorage: new MemoryMetaStorage(),
        createId: () => 'copilot-rollback',
      })
    ).rejects.toThrow('Injected Copilot memory token write failure')

    expect(destination.values.get(BackupStorageKey.CopilotMemories)).toEqual(previousMemories)
    expect(destination.values.get(BackupStorageKey.CopilotMemoryOwners)).toEqual(previousOwners)
    expect(destination.values.get(BackupStorageKey.CopilotMemoryTokens)).toEqual(previousTokens)
    expect(Array.from(destination.values.keys()).some((key) => key.startsWith('__chatbox_backup_import:'))).toBe(false)
  })
})
