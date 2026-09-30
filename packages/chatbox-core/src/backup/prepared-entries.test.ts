import type { Message, Session } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import { exportBackupArchive } from './export-backup'
import { importBackupArchive } from './import-backup'
import { prepareBackupExport } from './preflight'
import type { BackupSessionStore } from './session-port'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import { backupSessionStorageKey } from './storage-keys'
import { readZipFileEntries } from './zip'

async function fixture() {
  const database = openNodeSessionRowDatabase()
  const rows = new SqlSessionRowStore(database)
  const storage = new MemoryStorage()
  const metaStorage = new MemoryMetaStorage()
  storage.blobs.set('picture:shared', 'data:image/png;base64,YWJj')
  for (let index = 0; index < 12; index++) {
    const messages = [
      { id: `u${index}`, role: 'user', contentParts: [{ type: 'text', text: `question ${index} 中🙂`.repeat(40) }] },
      {
        id: `a${index}`,
        role: 'assistant',
        contentParts: [
          { type: 'text', text: `answer ${index} "quoted"\n`.repeat(200) },
          ...(index % 3 === 0 ? [{ type: 'image', storageKey: 'picture:shared' }] : []),
          ...(index % 4 === 0 ? [{ type: 'image', url: 'https://example.com/remote.png' }] : []),
        ],
      },
    ] as unknown as Message[]
    await rows.writeRows(contextSnapshot({ id: `s${index}`, name: `Session ${index}`, messages }))
    metaStorage.records.set(`s${index}`, {
      id: `s${index}`,
      name: `Session ${index}`,
      sortOrder: index,
      createdAt: index,
    })
  }
  let reads = 0
  const store: BackupSessionStore = {
    listSessionIds: () => rows.listSessionIds(),
    beginBackupRestore: (id) => rows.beginBackupRestore(id),
    async *iterateBackupRows(...args) {
      reads++
      yield* rows.iterateBackupRows(...args)
    },
  }
  const options = {
    storage,
    metaStorage,
    sessionStore: store,
    exportItems: ['conversations'] as ['conversations'],
    includeKeys: false,
    exportedAt: new Date(0),
    application: { version: 'test', platform: 'test' },
  }
  return { database, options, reads: () => reads, resetReads: () => (reads = 0) }
}

async function exportWith(options: Awaited<ReturnType<typeof fixture>>['options'], preparedEntryBytes?: number) {
  const prepared = await prepareBackupExport(options, { preparedEntryBytes })
  let archive = new Blob()
  const result = await exportBackupArchive({
    ...options,
    prepared,
    writeArchive: async (stream) => {
      const parts: Uint8Array<ArrayBuffer>[] = []
      for await (const part of stream()) parts.push(new Uint8Array(part))
      archive = new Blob(parts)
      return { boundedMemory: true }
    },
  })
  const files = new Map<string, string>()
  await readZipFileEntries(archive, (entry) => {
    files.set(entry.path, new TextDecoder().decode(entry.data))
  })
  return { prepared, manifest: result.manifest, archive, files }
}

describe('prepared session entries', () => {
  it('write the same archive content as reading each session again', async () => {
    const { database, options } = await fixture()
    try {
      const cached = await exportWith(options)
      const partial = await exportWith(options, 1)
      const reread = await exportWith(options, 0)
      expect(cached.prepared.entries?.size).toBe(0)
      expect(cached.manifest).toEqual(reread.manifest)
      expect(partial.manifest).toEqual(reread.manifest)
      expect(cached.files).toEqual(reread.files)
      expect(partial.files).toEqual(reread.files)
      expect(cached.manifest.resources).toHaveLength(1)

      const restored = new MemoryStorage()
      await importBackupArchive(cached.archive, { storage: restored, metaStorage: new MemoryMetaStorage() })
      const session = restored.values.get(backupSessionStorageKey('s3')) as Session
      expect(session.messages[1].contentParts).toContainEqual(expect.objectContaining({ type: 'image' }))
      expect(restored.blobs.get('picture:shared')).toBe('data:image/png;base64,YWJj')
    } finally {
      database.close()
    }
  })

  it('export reads no session a second time when every entry was retained', async () => {
    const { database, options, reads, resetReads } = await fixture()
    try {
      const prepared = await prepareBackupExport(options)
      expect(reads()).toBe(12)
      expect(prepared.entries?.size).toBe(12)
      const retained = prepared.entries?.get('s0')?.session
      expect(retained?.messages).toEqual([])
      expect(Object.keys(retained ?? {}).every((key) => !['threads', 'messageForksHash'].includes(key))).toBe(true)
      resetReads()
      await exportBackupArchive({
        ...options,
        prepared,
        writeArchive: async (stream) => {
          for await (const part of stream()) void part
          return { boundedMemory: true }
        },
      })
      expect(reads()).toBe(0)
      expect(prepared.entries?.size).toBe(0)
    } finally {
      database.close()
    }
  })
})
