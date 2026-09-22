import type { Session } from '@shared/types'
import { unzipSync, zipSync } from 'fflate'
import { expect, it, vi } from 'vitest'
import { RowBackedSessionRepository } from '../application/session/RowBackedSessionRepository'
import { openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import type { SessionRecordStorePort, StoredSessionRecord } from '../ports/session-record-store'
import { exportBackupArchive } from './export-backup'
import { importBackupArchive } from './import-backup'
import { legacyBackupSource } from './legacy-source'
import { prepareBackupExport, SINGLE_BACKUP_SESSION_BYTES } from './preflight'
import { createRecordBackupSessionStore } from './record-session-store'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import { BackupManifestV3Schema } from './sharded-format'

const orphan: Session = {
  id: 'legacy',
  name: 'Legacy branches',
  messages: [{ id: 'visible', role: 'user', contentParts: [{ type: 'text', text: 'visible' }] }],
  messageForksHash: {
    missing: {
      position: 1,
      createdAt: 1,
      lists: [
        {
          id: 'saved',
          messages: [
            {
              id: 'orphan',
              role: 'assistant',
              contentParts: [
                { type: 'text', text: 'must survive' },
                { type: 'image', storageKey: 'picture' },
              ],
            },
          ],
        },
        { id: 'active', messages: [] },
      ],
    },
  },
}

function harness() {
  const database = openNodeSessionRowDatabase()
  const rows = new SqlSessionRowStore(database)
  const storage = new MemoryStorage()
  const records: SessionRecordStorePort = {
    initialize: async () => {},
    getRecord: (id) => storage.getItem<StoredSessionRecord | null>(`session:${id}`, null),
    setRecord: (value) => storage.setItemNow(`session:${value.id}`, value),
    removeRecord: (id) => storage.removeItem(`session:${id}`),
    listIds: async () => [...storage.values.keys()].filter((k) => k.startsWith('session:')).map((k) => k.slice(8)),
  }
  const snapshots = new Map<string, StoredSessionRecord>()
  const store = createRecordBackupSessionStore(
    rows,
    records,
    {
      stage: async (token, session) => {
        snapshots.set(token, structuredClone(session))
      },
      capture: async (id, token) => {
        const value = await records.getRecord(id)
        if (value) snapshots.set(token, structuredClone(value))
        return value !== null
      },
      restore: async (id, token, existed) => {
        if (existed) await records.setRecord(snapshots.get(token)!)
        else await records.removeRecord(id)
      },
      remove: async (token) => {
        snapshots.delete(token)
      },
    },
    {
      listSessionIds: () => records.listIds(),
      readValue: async (id) => (await records.getRecord(id)) as Session | null,
    }
  )
  return { database, rows, storage, records, snapshots, store }
}

it.each(['materialized', 'range'] as const)(
  'backs up and restores orphan branches in bounded v2 %s mode',
  async (mode) => {
    const h = harness()
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(orphan))
      const readValue = vi.fn(async () => structuredClone(orphan))
      const source = legacyBackupSource(h.rows, {
        listSessionIds: async () => [orphan.id],
        readValue,
        open:
          mode === 'range'
            ? async () => ({
                size: bytes.length,
                text: async () => new TextDecoder().decode(bytes),
                readBytes: async (offset, length) => bytes.slice(offset, offset + length),
              })
            : undefined,
      })
      h.storage.blobs.set('picture', 'data:image/png;base64,YWJj')
      const options = {
        storage: h.storage,
        metaStorage: new MemoryMetaStorage(),
        sessionStore: source,
        exportItems: ['conversations'] as ['conversations'],
        includeKeys: false,
        application: { version: 'test', platform: 'test' },
      }
      const prepared = await prepareBackupExport(options)
      expect(prepared.sessions[0]).toMatchObject({
        layout: 'single',
        legacyTopology: 'unreachable fork missing contains messages',
      })
      expect(prepared.warnings).toEqual([])
      const parts: Uint8Array<ArrayBuffer>[] = []
      const result = await exportBackupArchive({
        ...options,
        prepared,
        writeArchive: async (stream) => {
          for await (const part of stream()) parts.push(new Uint8Array(part))
          return { boundedMemory: true }
        },
      })
      expect(result.manifest.sessions[0].legacyTopology).toBe('unreachable fork missing contains messages')
      expect(result.manifest.resources).toHaveLength(1)
      const target = new MemoryStorage()
      await importBackupArchive(new Blob(parts), { storage: target, metaStorage: new MemoryMetaStorage() })
      expect((target.values.get('session:legacy') as Session).messageForksHash).toEqual(orphan.messageForksHash)
      if (mode === 'range') expect(readValue).not.toHaveBeenCalled()
    } finally {
      h.database.close()
    }
  }
)

it('round trips mixed v3 legacy and sharded sessions and rolls back an overwritten row marker', async () => {
  const h = harness(),
    target = harness()
  try {
    await h.records.setRecord(orphan)
    h.storage.blobs.set('picture', 'data:image/png;base64,YWJj')
    const large = contextSnapshot({
      id: 'large',
      name: 'Large',
      messages: [{ id: 'large-message', role: 'user', contentParts: [{ type: 'text', text: 'large'.repeat(5000) }] }],
    })
    await h.rows.writeRows(large)
    await h.records.setRecord(large.record)
    const options = {
      storage: h.storage,
      metaStorage: new MemoryMetaStorage(),
      sessionStore: h.store,
      exportItems: ['conversations'] as ['conversations'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
    }
    const prepared = await prepareBackupExport(options, { singleSessionBytes: 1024 })
    expect(prepared.formatVersion).toBe(3)
    const parts: Uint8Array<ArrayBuffer>[] = []
    await exportBackupArchive({
      ...options,
      prepared,
      writeArchive: async (stream) => {
        for await (const part of stream()) parts.push(new Uint8Array(part))
        return { boundedMemory: true }
      },
    })
    const archive = new Blob(parts)
    const old = contextSnapshot({ id: orphan.id, name: 'Old row data', messages: [] })
    await target.rows.writeRows(old)
    await target.records.setRecord(old.record)
    const controller = new AbortController()
    await expect(
      importBackupArchive(archive, {
        storage: target.storage,
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: target.store },
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.phase === 'finishing' && progress.current === 1) controller.abort()
        },
      })
    ).rejects.toThrow()
    expect(await target.records.getRecord(orphan.id)).toEqual(old.record)
    expect(target.snapshots.size).toBe(0)
    const restored = await importBackupArchive(archive, {
      storage: target.storage,
      metaStorage: new MemoryMetaStorage(),
      sharded: { store: target.store },
    })
    expect(restored.restoredSessionCount).toBe(2)
    expect(((await target.records.getRecord(orphan.id)) as Session).messageForksHash).toEqual(orphan.messageForksHash)
    const repo = new RowBackedSessionRepository({ records: target.records, rows: target.rows })
    expect((await repo.getSession(orphan.id))?.messages).toEqual(orphan.messages)
    const again = await prepareBackupExport({ ...options, sessionStore: target.store })
    expect(again.sessions.find((s) => s.id === orphan.id)).toMatchObject({
      legacyTopology: 'unreachable fork missing contains messages',
    })
    // 清单标记不是绕过校验的通行证：未明确声明旧 JSON 兼容项的损坏分支仍须拒绝。
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()))
    const manifest = BackupManifestV3Schema.parse(JSON.parse(new TextDecoder().decode(entries['manifest.json'])))
    const legacyEntry = manifest.sessions.find((s) => s.id === orphan.id)!
    legacyEntry.legacyTopology = 'Diagnostic wording from another application version'
    entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    await expect(
      importBackupArchive(new Blob([new Uint8Array(zipSync(entries))]), {
        storage: target.storage,
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: target.store },
      })
    ).resolves.toMatchObject({ restoredSessionCount: 2 })
    delete legacyEntry.legacyTopology
    entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    await expect(
      importBackupArchive(new Blob([new Uint8Array(zipSync(entries))]), {
        storage: target.storage,
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: target.store },
      })
    ).rejects.toThrow('unreachable fork')
  } finally {
    h.database.close()
    target.database.close()
  }
})

it('rejects an oversized legacy fallback before reading its body', async () => {
  const h = harness()
  try {
    const readBytes = vi.fn(async () => {
      throw new Error('Must not read')
    })
    const source = legacyBackupSource(h.rows, {
      listSessionIds: async () => ['large'],
      open: async () => ({ size: SINGLE_BACKUP_SESSION_BYTES + 1, text: readBytes, readBytes }),
    })
    await expect(source.readLegacySession!('large', SINGLE_BACKUP_SESSION_BYTES)).rejects.toThrow(
      'single-file backup limit'
    )
    expect(readBytes).not.toHaveBeenCalled()
  } finally {
    h.database.close()
  }
})
