import { afterEach, expect, it } from 'vitest'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import { exportBackupArchiveWithRows as exportBackupArchive } from './export.test-support'
import { importBackupArchiveWithRows as importBackupArchive } from './import.test-support'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import { BackupStorageKey } from './storage-keys'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

it('restores folder membership from the backup and keeps local folders', async () => {
  const db = openNodeSessionRowDatabase()
  databases.push(db)
  const source = new SqlSessionRowStore(db)
  await source.writeRows(
    contextSnapshot({
      id: 'restored',
      name: 'Restored',
      messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'text', text: 'hello' }] }],
    })
  )
  const sourceStorage = new MemoryStorage()
  sourceStorage.values.set(BackupStorageKey.SessionFolders, [{ id: 'imported', name: 'Imported' }])
  let archive = new Blob()
  const { manifest } = await exportBackupArchive({
    sessionStore: source,
    storage: sourceStorage,
    metaStorage: new MemoryMetaStorage(),
    exportItems: ['conversations'],
    includeKeys: false,
    application: { version: 'test', platform: 'test' },
    writeArchive: async (stream) => {
      const parts: Uint8Array<ArrayBuffer>[] = []
      for await (const part of stream()) parts.push(new Uint8Array(part))
      archive = new Blob(parts)
      return { boundedMemory: true }
    },
  })
  expect(manifest.formatVersion).toBe(2)

  const storage = new MemoryStorage()
  storage.values.set(BackupStorageKey.SessionFolders, [{ id: 'local', name: 'Local' }])
  const metaStorage = new MemoryMetaStorage()
  metaStorage.records.set('restored', {
    id: 'restored',
    name: 'Local copy',
    folderId: 'local',
    sortOrder: 1,
    createdAt: 1,
  })

  await importBackupArchive(archive, { storage, metaStorage })

  expect(metaStorage.records.get('restored')?.folderId).toBeUndefined()
  expect(storage.values.get(BackupStorageKey.SessionFolders)).toEqual([
    { id: 'local', name: 'Local' },
    { id: 'imported', name: 'Imported' },
  ])
})
