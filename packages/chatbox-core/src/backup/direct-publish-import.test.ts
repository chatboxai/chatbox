import { InMemorySessionRowStore } from '../testing'
import { stageLegacySessionRows } from './legacy-row-import'
import { describe, expect, it } from 'vitest'
import { sha256Checksum } from './codec'
import { exportBackupArchiveWithRows as exportBackupArchive } from './export.test-support'
import { importBackupArchive } from './import-backup'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'

async function createArchive(count: number) {
  const source = new MemoryStorage()
  for (let index = 0; index < count; index++)
    source.values.set(`session:s${index}`, {
      id: `s${index}`,
      name: `imported ${index}`,
      messages: [{ id: `m${index}`, role: 'user', contentParts: [{ type: 'text', text: `text ${index}` }] }],
    })
  source.values.set('settings', { language: 'zh' })
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

class RecordingStorage extends MemoryStorage {
  writes: string[] = []
  override setItemNow<T>(key: string, value: T): Promise<void> {
    this.writes.push(key)
    return super.setItemNow(key, value)
  }
}

class CopyingStorage extends RecordingStorage {
  copies: Array<[string, string]> = []
  copyItem(source: string, destination: string): Promise<boolean> {
    this.copies.push([source, destination])
    if (!this.values.has(source)) return Promise.resolve(false)
    this.values.set(destination, this.values.get(source))
    return Promise.resolve(true)
  }
}

describe('v2 import publishes row candidates from the archive', () => {
  it('publishes sessions with no generic session-key reads or writes', async () => {
    const storage = new RecordingStorage()
    const rows = new InMemorySessionRowStore()
    const previous = await stageLegacySessionRows(rows, { id: 's1', name: 'local', messages: [] })
    await previous.publish()
    await previous.dispose()

    await importBackupArchive(await createArchive(3), {
      storage,
      metaStorage: new MemoryMetaStorage(),
      sharded: { store: rows },
    })

    expect(storage.writes.filter((key) => key.includes(':session:'))).toEqual([])
    expect(storage.writes.filter((key) => key.startsWith('session:'))).toEqual([])
    expect(storage.writes.filter((key) => key.includes(':rollback:'))).toHaveLength(0)
    expect((await rows.readCommit('s1'))?.record.name).toBe('imported 1')
    expect((await rows.listSessionIds()).sort()).toEqual(['s0', 's1', 's2'])
    expect([...storage.values.keys()].some((key) => key.startsWith('__chatbox_backup_import:'))).toBe(false)
  })

  it('rolls back when a session entry changes between the validating and publishing reads', async () => {
    const archive = await createArchive(3)
    const storage = new RecordingStorage()
    const rows = new InMemorySessionRowStore()
    const previous = await stageLegacySessionRows(rows, { id: 's1', name: 'local', messages: [] })
    await previous.publish()
    await previous.dispose()
    const seen = new Set<string>()
    const checksum: typeof sha256Checksum = async (bytes) => {
      const result = await sha256Checksum(bytes)
      const text = new TextDecoder().decode(bytes)
      if (!text.includes('"imported 2"')) return result
      if (seen.has(result.value)) return { ...result, value: '0'.repeat(64) }
      seen.add(result.value)
      return result
    }

    await expect(
      importBackupArchive(archive, {
        storage,
        metaStorage: new MemoryMetaStorage(),
        checksum,
        sharded: { store: rows },
      })
    ).rejects.toThrow(/Backup changed during restore: sessions\//)

    expect((await rows.readCommit('s1'))?.record.name).toBe('local')
    expect(await rows.listSessionIds()).toEqual(['s1'])
    expect([...storage.values.keys()].some((key) => key.startsWith('__chatbox_backup_import:'))).toBe(false)
  })

  it('snapshots and restores existing values with native copies', async () => {
    const archive = await createArchive(2)
    const storage = new CopyingStorage()
    const original = { language: 'en' }
    storage.values.set('settings', original)
    const rows = new InMemorySessionRowStore()
    class FailingMeta extends MemoryMetaStorage {
      override create(): Promise<void> {
        return Promise.reject(new Error('Metadata write failed'))
      }
    }

    await expect(
      importBackupArchive(archive, { storage, metaStorage: new FailingMeta(), sharded: { store: rows } })
    ).rejects.toThrow('Metadata write failed')

    expect(storage.values.get('settings')).toBe(original)
    expect(storage.copies.map(([source]) => source)).toContain('settings')
    expect(storage.copies.some(([, destination]) => destination === 'settings')).toBe(true)
    expect(storage.writes.filter((key) => key.includes(':rollback:'))).toEqual([])
  })
})
