import { expect, it, vi } from 'vitest'
import { exportBackupArchiveWithRows as exportBackupArchive } from './export.test-support'
import { prepareBackupExport } from './preflight'
import {
  importBackupArchiveWithRows as importBackupArchive,
  readImportedSession,
  importedRows,
  seedImportedSession,
} from './import.test-support'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import type { Session } from '@shared/types'

it('retains new resources and the old value when session rollback fails', async () => {
  const source = new MemoryStorage()
  source.values.set('session:s', {
    id: 's',
    name: 'new',
    messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'image', storageKey: 'image' }] }],
  })
  source.blobs.set('image', 'data:image/png;base64,YWJj')
  let archive = new Blob()
  await exportBackupArchive({
    storage: source,
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
  class Meta extends MemoryMetaStorage {
    override async create() {
      throw new Error('Meta write failure')
    }
  }
  const target = new MemoryStorage()
  await seedImportedSession(target, { id: 's', name: 'old', messages: [] })
  const rows = importedRows(target)
  const begin = rows.beginBackupRestore.bind(rows)
  const retained: import('./session-port').BackupSessionCandidate[] = []
  vi.spyOn(rows, 'beginBackupRestore').mockImplementation(async (...args) => {
    const candidate = await begin(...args)
    retained.push(candidate)
    return {
      ...candidate,
      rollback: async () => {
        throw new Error('Rollback disk failure')
      },
    }
  })
  await expect(importBackupArchive(archive, { storage: target, metaStorage: new Meta() })).rejects.toThrow(
    /rollback failed/i
  )
  expect((await readImportedSession(target, 's')).name).toBe('new')
  expect(target.blobs.get('image')).toBe('data:image/png;base64,YWJj')
  expect(retained).toHaveLength(1)
  await retained[0].rollback()
  expect((await readImportedSession(target, 's')).name).toBe('old')
  await retained[0].dispose()
})

it('reports classification failures and rejects an unreadable session once output has started', async () => {
  const { openNodeSessionRowDatabase } = await import('../persistence/node-sqlite.test-support')
  const { SqlSessionRowStore } = await import('../persistence/session-row-sql')
  const { contextSnapshot } = await import('../persistence/session-context-read.test-support')
  const database = openNodeSessionRowDatabase()
  try {
    const rows = new SqlSessionRowStore(database)
    await rows.writeRows(
      contextSnapshot({
        id: 'good',
        name: 'Good',
        messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'text', text: 'before' }] }],
      })
    )
    let outputStarted = false
    let failOutput = false
    const store: import('./session-port').BackupSessionStore = {
      listSessionIds: async () => ['bad', 'good'],
      beginBackupRestore: (id) => rows.beginBackupRestore(id),
      async *iterateBackupRows(id, limits, signal) {
        if (id === 'bad' || (failOutput && outputStarted)) throw new Error('Source disk read failed')
        yield* rows.iterateBackupRows(id, limits, signal)
      },
    }
    const options: import('./export-backup').BackupExportOptions = {
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      sessionStore: store,
      exportItems: ['conversations'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (stream) => {
        outputStarted = true
        for await (const part of stream()) void part
        return { boundedMemory: true }
      },
    }
    const result = await exportBackupArchive(options)
    expect(result.manifest.sessions.map((session) => session.id)).toEqual(['good'])
    expect(result.manifest.warnings).toContainEqual(
      expect.objectContaining({ code: 'session-read-failed', itemId: 'bad' })
    )
    outputStarted = false
    // Without retained entries, export reads each session again while writing.
    const prepared = await prepareBackupExport({ ...options, sessionStore: store }, { preparedEntryBytes: 0 })
    failOutput = true
    await expect(exportBackupArchive({ ...options, prepared })).rejects.toThrow('Source disk read failed')
  } finally {
    database.close()
  }
})

it('reports cleanup failure after commit without rolling back from already deleted snapshots', async () => {
  const source = new MemoryStorage()
  source.values.set('settings', { language: 'en' })
  source.values.set('session:s', { id: 's', name: 'restored', messages: [] })
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
  class Destination extends MemoryStorage {
    override async removeItem(key: string) {
      if (key.startsWith('__chatbox_backup_import:')) throw new Error('Cleanup disk failure')
      return super.removeItem(key)
    }
  }
  const destination = new Destination()
  destination.values.set('settings', { language: 'zh' })
  destination.values.set('session:s', { id: 's', name: 'old', messages: [] })
  await expect(
    importBackupArchive(archive, { storage: destination, metaStorage: new MemoryMetaStorage() })
  ).rejects.toThrow(/data restored; cleanup failed/)
  expect((await readImportedSession(destination, 's')).name).toBe('restored')
})
