import { afterEach, expect, it } from 'vitest'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { openNodeSessionRowDatabase, type NodeSessionRowSqlDatabase } from '../persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import { exportBackupArchive, type BackupExportOptions } from './export-backup'
import { importBackupArchive } from './import-backup'
import { prepareBackupExport } from './preflight'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import { BackupStorageKey, backupSessionStorageKey } from './storage-keys'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
function store() {
  const db = openNodeSessionRowDatabase()
  databases.push(db)
  return new SqlSessionRowStore(db)
}
async function exportArchive(options: Omit<BackupExportOptions, 'writeArchive'>) {
  let archive = new Blob()
  const result = await exportBackupArchive({
    ...options,
    writeArchive: async (stream) => {
      const parts: Uint8Array<ArrayBuffer>[] = []
      for await (const part of stream()) parts.push(new Uint8Array(part))
      archive = new Blob(parts)
      return { boundedMemory: true }
    },
  })
  return { archive, result }
}

it('round trips a v2 session with ten thousand short messages', async () => {
  const source = store()
  const messages = Array.from({ length: 10_000 }, (_, index) => ({
    id: `m${index}`,
    role: 'user' as const,
    contentParts: [{ type: 'text' as const, text: 'ok' }],
  }))
  await source.writeRows(contextSnapshot({ id: 'many-short', name: 'Many short messages', messages }))
  const options = {
    sessionStore: source,
    storage: new MemoryStorage(),
    metaStorage: new MemoryMetaStorage(),
    exportItems: ['conversations'] as ['conversations'],
    includeKeys: false,
    application: { version: 'test', platform: 'test' },
  }
  const prepared = await prepareBackupExport(options)
  expect(prepared.sessions[0]).toMatchObject({ layout: 'single' })
  const { archive, result } = await exportArchive({ ...options, prepared })
  expect(result.manifest.formatVersion).toBe(2)
  expect(result.manifest.warnings).toEqual([])
  const restored = new MemoryStorage()
  await importBackupArchive(archive, { storage: restored, metaStorage: new MemoryMetaStorage() })
  expect(restored.values.get(backupSessionStorageKey('many-short'))).toMatchObject({ messages })
}, 30000)

it.each([600 * 1024, 4 * 1024 * 1024 + 1])(
  'round trips v3 global JSON entries with %i bytes of text',
  async (bytes) => {
    const source = store()
    const destination = store()
    await source.writeRows(
      contextSnapshot({
        id: 'sharded',
        name: 'Sharded',
        messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'text', text: 'conversation'.repeat(1000) }] }],
      })
    )
    const text = 'x'.repeat(bytes)
    const storage = new MemoryStorage()
    storage.values.set(BackupStorageKey.Settings, { defaultPrompt: text })
    storage.values.set(BackupStorageKey.MyCopilots, [{ id: 'c', name: 'Copilot', prompt: text }])
    storage.values.set(BackupStorageKey.ChatSessionSettings, { defaultPrompt: text })
    const options = {
      sessionStore: source,
      storage,
      metaStorage: new MemoryMetaStorage(),
      exportItems: ['conversations', 'setting', 'copilot'] as ['conversations', 'setting', 'copilot'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
    }
    const prepared = await prepareBackupExport(options, { singleSessionBytes: 1024 })
    const { archive, result } = await exportArchive({ ...options, prepared })
    expect(result.manifest.formatVersion).toBe(3)
    for (const entry of Object.values(result.manifest.data)) expect(entry.size).toBeGreaterThan(bytes)
    const restored = new MemoryStorage()
    await importBackupArchive(archive, {
      storage: restored,
      metaStorage: new MemoryMetaStorage(),
      sharded: { store: destination },
    })
    expect(restored.values.get(BackupStorageKey.Settings)).toMatchObject({ defaultPrompt: text })
    expect(restored.values.get(BackupStorageKey.MyCopilots)).toEqual([{ id: 'c', name: 'Copilot', prompt: text }])
    expect(restored.values.get(BackupStorageKey.ChatSessionSettings)).toEqual({ defaultPrompt: text })
    expect((await destination.readSnapshot('sharded'))?.rows.messages[0].message.contentParts).toEqual([
      { type: 'text', text: 'conversation'.repeat(1000) },
    ])
  },
  30000
)
