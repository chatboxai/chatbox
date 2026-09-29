import type { Session } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { sha256Checksum } from './codec'
import { exportBackupArchive } from './export-backup'
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

describe('v2 import publishes sessions from the archive', () => {
  it('writes each session once without staging it', async () => {
    const storage = new RecordingStorage()
    storage.values.set('session:s1', { id: 's1', name: 'local', messages: [] })

    await importBackupArchive(await createArchive(3), { storage, metaStorage: new MemoryMetaStorage() })

    expect(storage.writes.filter((key) => key.includes(':session:'))).toEqual([])
    expect(storage.writes.filter((key) => key.startsWith('session:')).sort()).toEqual([
      'session:s0',
      'session:s1',
      'session:s2',
    ])
    expect(storage.writes.filter((key) => key.includes(':rollback:'))).toHaveLength(1)
    expect((storage.values.get('session:s1') as Session).name).toBe('imported 1')
    expect([...storage.values.keys()].some((key) => key.startsWith('__chatbox_backup_import:'))).toBe(false)
  })

  it('rolls back when a session entry changes between the validating and publishing reads', async () => {
    const archive = await createArchive(3)
    const storage = new RecordingStorage()
    storage.values.set('session:s1', { id: 's1', name: 'local', messages: [] })
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
      importBackupArchive(archive, { storage, metaStorage: new MemoryMetaStorage(), checksum })
    ).rejects.toThrow(/Backup changed during restore: sessions\//)

    expect((storage.values.get('session:s1') as Session).name).toBe('local')
    expect([...storage.values.keys()].filter((key) => key.startsWith('session:'))).toEqual(['session:s1'])
    expect([...storage.values.keys()].some((key) => key.startsWith('__chatbox_backup_import:'))).toBe(false)
  })

  it('snapshots and restores existing values with native copies', async () => {
    const archive = await createArchive(2)
    const storage = new CopyingStorage()
    const original = { id: 's0', name: 'local', messages: [] }
    storage.values.set('session:s0', original)
    class FailingMeta extends MemoryMetaStorage {
      override create(): Promise<void> {
        return Promise.reject(new Error('Metadata write failed'))
      }
    }

    await expect(importBackupArchive(archive, { storage, metaStorage: new FailingMeta() })).rejects.toThrow(
      'Metadata write failed'
    )

    expect(storage.values.get('session:s0')).toBe(original)
    expect(storage.copies.map(([source]) => source)).toContain('session:s0')
    expect(storage.copies.some(([, destination]) => destination === 'session:s0')).toBe(true)
    expect(storage.writes.filter((key) => key.includes(':rollback:'))).toEqual([])
  })
})
