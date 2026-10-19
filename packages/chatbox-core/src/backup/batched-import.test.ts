import type { Session, SessionMetaRecord } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { exportBackupArchiveWithRows as exportBackupArchive } from './export.test-support'
import {
  importBackupArchiveWithRows as importBackupArchive,
  readImportedSession,
  importedRows,
  seedImportedSession,
} from './import.test-support'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'

const SESSION_COUNT = 150

async function createArchive() {
  const source = new MemoryStorage()
  source.values.set('settings', { language: 'en' })
  for (let index = 0; index < SESSION_COUNT; index++)
    source.values.set(`session:s${index}`, {
      id: `s${index}`,
      name: `imported ${index}`,
      messages: [{ id: `m${index}`, role: 'user', contentParts: [{ type: 'text', text: `text ${index}` }] }],
    })
  let archive = new Blob()
  await exportBackupArchive({
    storage: source,
    metaStorage: new MemoryMetaStorage(),
    exportItems: ['conversations', 'setting'],
    includeKeys: false,
    application: { version: 'test', platform: 'test' },
    writeArchive: async (stream) => {
      const parts: Uint8Array<ArrayBuffer>[] = []
      for await (const part of stream()) parts.push(new Uint8Array(part))
      archive = new Blob(parts)
      return { boundedMemory: true }
    },
  })
  return archive
}

class BatchStorage extends MemoryStorage {
  removeBatches: string[][] = []
  failRemoveBatch = false
  removeItems(keys: string[]): Promise<void> {
    this.removeBatches.push(keys)
    if (this.failRemoveBatch) return Promise.reject(new Error('Batch removal failed'))
    for (const key of keys) this.values.delete(key)
    return Promise.resolve()
  }
  singleRemovals: string[] = []
  override removeItem(key: string): Promise<void> {
    this.singleRemovals.push(key)
    return super.removeItem(key)
  }
}

class BatchMetaStorage extends MemoryMetaStorage {
  batches: SessionMetaRecord[][] = []
  failBatch: number | null = null
  createMany(records: SessionMetaRecord[]): Promise<void> {
    this.batches.push(records)
    if (this.batches.length === this.failBatch) return Promise.reject(new Error('Metadata batch failed'))
    for (const record of records) this.records.set(record.id, record)
    return Promise.resolve()
  }
  /** Rollback restores metadata through single writes; publication must not use them. */
  allowSingleWrites = false
  override update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null> {
    if (!this.allowSingleWrites) throw new Error('Unexpected single metadata update')
    return super.update(id, updates)
  }
  override create(record: SessionMetaRecord): Promise<void> {
    if (!this.allowSingleWrites) throw new Error('Unexpected single metadata create')
    return super.create(record)
  }
}

async function seed(storage: MemoryStorage, meta: MemoryMetaStorage) {
  storage.values.set('settings', { language: 'zh' })
  await seedImportedSession(storage, { id: 's0', name: 'local', messages: [] })
  meta.records.set('s0', { id: 's0', name: 'local', starred: true, sortOrder: 7, createdAt: 3 })
}

describe('batched backup import', () => {
  it('publishes the same data as single writes with bounded batches', async () => {
    const archive = await createArchive()
    const expectedStorage = new MemoryStorage()
    const expectedMeta = new MemoryMetaStorage()
    await seed(expectedStorage, expectedMeta)
    await importBackupArchive(archive, {
      storage: expectedStorage,
      metaStorage: expectedMeta,
      createId: () => 'batch-import',
    })

    const storage = new BatchStorage()
    const meta = new BatchMetaStorage()
    await seed(storage, meta)
    await importBackupArchive(archive, { storage, metaStorage: meta, createId: () => 'batch-import' })

    expect([...storage.values.keys()]).toEqual([...expectedStorage.values.keys()])
    expect(storage.values.get('settings')).toMatchObject({ language: 'en', memoryStateToken: expect.any(String) })
    expect(await importedRows(storage).listSessionIds()).toHaveLength(SESSION_COUNT)
    for (const id of await importedRows(storage).listSessionIds())
      expect(await readImportedSession(storage, id)).toEqual(await readImportedSession(expectedStorage, id))
    expect(meta.records).toEqual(expectedMeta.records)
    expect(meta.records.get('s0')?.starred).toBe(true)
    expect(meta.batches.map((batch) => batch.length)).toEqual([64, 64, 22])
    expect(storage.removeBatches.every((batch) => batch.length <= 64)).toBe(true)
    expect(storage.singleRemovals).toEqual([])
    expect([...storage.values.keys()].some((key) => key.startsWith('__chatbox_backup_import:'))).toBe(false)
  })

  it('rolls back sessions and metadata when a metadata batch fails', async () => {
    const archive = await createArchive()
    const storage = new BatchStorage()
    const meta = new BatchMetaStorage()
    await seed(storage, meta)
    meta.failBatch = 2
    meta.allowSingleWrites = true

    await expect(
      importBackupArchive(archive, { storage, metaStorage: meta, createId: () => 'batch-import' })
    ).rejects.toThrow('Metadata batch failed')

    expect((await readImportedSession(storage, 's0')).name).toBe('local')
    expect(await importedRows(storage).listSessionIds()).toEqual(['s0'])
    expect([...meta.records.values()]).toEqual([{ id: 's0', name: 'local', starred: true, sortOrder: 7, createdAt: 3 }])
  })

  it('reports temporary keys retained by a failed cleanup batch after the data is restored', async () => {
    const archive = await createArchive()
    const storage = new BatchStorage()
    const meta = new BatchMetaStorage()
    await seed(storage, meta)
    storage.failRemoveBatch = true

    await expect(
      importBackupArchive(archive, { storage, metaStorage: meta, createId: () => 'batch-import' })
    ).rejects.toThrow(/data restored; cleanup failed; retained keys: __chatbox_backup_import:/)
    expect(meta.records.size).toBe(SESSION_COUNT)
  })
})
