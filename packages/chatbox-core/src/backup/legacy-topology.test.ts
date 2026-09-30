import type { Session } from '@shared/types'
import { unzipSync, zipSync } from 'fflate'
import { expect, it, vi } from 'vitest'
import { RowBackedSessionRepository } from '../application/session/RowBackedSessionRepository'
import { openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import type { SessionRecordStorePort, StoredSessionRecord } from '../ports/session-record-store'
import { UNENCODABLE_MESSAGE_ID, UNENCODABLE_REASON } from '../session/session-tree/unencodable.test-support'
import { exportBackupArchive } from './export-backup'
import { importBackupArchive } from './import-backup'
import { LegacyBackupTopologyError, legacyBackupSource } from './legacy-source'
import { prepareBackupExport, SINGLE_BACKUP_SESSION_BYTES } from './preflight'
import { createRecordBackupSessionStore } from './record-session-store'
import type { BackupPageLimits } from './session-port'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import { BackupManifestV3Schema } from './sharded-format'

vi.mock('../session/session-tree/encode', async (importOriginal) => {
  const { failOnUnencodableMarker } = await import('../session/session-tree/unencodable.test-support')
  const actual = await importOriginal<typeof import('../session/session-tree/encode')>()
  return { ...actual, encodeSessionTree: failOnUnencodableMarker(actual.encodeSessionTree) }
})

const LEGACY_REASON = UNENCODABLE_REASON

// A saved branch holding the marker cannot be row-encoded, so backups keep the session as legacy JSON.
const legacy: Session = {
  id: 'legacy',
  name: 'Legacy branches',
  messages: [{ id: 'visible', role: 'user', contentParts: [{ type: 'text', text: 'visible' }] }],
  messageForksHash: {
    visible: {
      position: 1,
      createdAt: 1,
      lists: [
        {
          id: 'saved',
          messages: [
            {
              id: UNENCODABLE_MESSAGE_ID,
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
  'backs up and restores legacy branches in bounded v2 %s mode',
  async (mode) => {
    const h = harness()
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(legacy))
      const readValue = vi.fn(async () => structuredClone(legacy))
      const source = legacyBackupSource(h.rows, {
        listSessionIds: async () => [legacy.id],
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
        legacyTopology: LEGACY_REASON,
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
      expect(result.manifest.sessions[0].legacyTopology).toBe(LEGACY_REASON)
      expect(result.manifest.resources).toHaveLength(1)
      const target = new MemoryStorage()
      await importBackupArchive(new Blob(parts), { storage: target, metaStorage: new MemoryMetaStorage() })
      expect((target.values.get('session:legacy') as Session).messageForksHash).toEqual(legacy.messageForksHash)
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
    await h.records.setRecord(legacy)
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
    const old = contextSnapshot({ id: legacy.id, name: 'Old row data', messages: [] })
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
    expect(await target.records.getRecord(legacy.id)).toEqual(old.record)
    expect(target.snapshots.size).toBe(0)
    const restored = await importBackupArchive(archive, {
      storage: target.storage,
      metaStorage: new MemoryMetaStorage(),
      sharded: { store: target.store },
    })
    expect(restored.restoredSessionCount).toBe(2)
    expect(((await target.records.getRecord(legacy.id)) as Session).messageForksHash).toEqual(legacy.messageForksHash)
    const repo = new RowBackedSessionRepository({ records: target.records, rows: target.rows })
    expect((await repo.getSession(legacy.id))?.messages).toEqual(legacy.messages)
    const again = await prepareBackupExport({ ...options, sessionStore: target.store })
    expect(again.sessions.find((s) => s.id === legacy.id)).toMatchObject({
      legacyTopology: LEGACY_REASON,
    })
    // 清单标记不是绕过校验的通行证：未明确声明旧 JSON 兼容项的损坏分支仍须拒绝。
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()))
    const manifest = BackupManifestV3Schema.parse(JSON.parse(new TextDecoder().decode(entries['manifest.json'])))
    const legacyEntry = manifest.sessions.find((s) => s.id === legacy.id)!
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
    ).rejects.toThrow(UNENCODABLE_REASON)
  } finally {
    h.database.close()
    target.database.close()
  }
})

it('restores an earlier backup that preserved an unreachable fork, dropping the fork', async () => {
  const h = harness(),
    target = harness()
  try {
    const unreachable: Session = {
      id: 'unreachable',
      name: 'Deleted branch point',
      messages: [{ id: 'visible', role: 'user', contentParts: [{ type: 'text', text: 'visible' }] }],
      messageForksHash: {
        deleted: {
          position: 1,
          createdAt: 1,
          lists: [
            {
              id: 'saved',
              messages: [{ id: 'hidden', role: 'assistant', contentParts: [{ type: 'text', text: 'never shown' }] }],
            },
            { id: 'active', messages: [] },
          ],
        },
      },
    }
    await h.records.setRecord(unreachable)
    const large = contextSnapshot({
      id: 'large',
      name: 'Large',
      messages: [{ id: 'large-message', role: 'user', contentParts: [{ type: 'text', text: 'large'.repeat(5000) }] }],
    })
    await h.rows.writeRows(large)
    await h.records.setRecord(large.record)
    // Earlier versions classified this session as legacy JSON and counted every stored message.
    const earlierStore = {
      ...h.store,
      iterateBackupRows(id: string, limits: BackupPageLimits, signal?: AbortSignal) {
        if (id !== unreachable.id) return h.store.iterateBackupRows(id, limits, signal)
        return (async function* () {
          yield* []
          throw new LegacyBackupTopologyError('unreachable fork deleted contains messages')
        })()
      },
    }
    const options = {
      storage: h.storage,
      metaStorage: new MemoryMetaStorage(),
      sessionStore: earlierStore,
      exportItems: ['conversations'] as ['conversations'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
    }
    const prepared = await prepareBackupExport(options, { singleSessionBytes: 1024 })
    expect(prepared.formatVersion).toBe(3)
    const parts: Uint8Array<ArrayBuffer>[] = []
    const exported = await exportBackupArchive({
      ...options,
      prepared,
      writeArchive: async (stream) => {
        for await (const part of stream()) parts.push(new Uint8Array(part))
        return { boundedMemory: true }
      },
    })
    expect(exported.manifest.sessions.find((s) => s.id === unreachable.id)).toMatchObject({
      layout: 'single',
      legacyTopology: 'unreachable fork deleted contains messages',
      counts: { threads: 1, messages: 2 },
    })

    const restored = await importBackupArchive(new Blob(parts), {
      storage: target.storage,
      metaStorage: new MemoryMetaStorage(),
      sharded: { store: target.store },
    })

    expect(restored.restoredSessionCount).toBe(2)
    await expect(target.rows.hasRows(unreachable.id)).resolves.toBe(true)
    const repo = new RowBackedSessionRepository({ records: target.records, rows: target.rows })
    const session = await repo.getSession(unreachable.id)
    expect(session?.messages).toEqual(unreachable.messages)
    expect(session?.messageForksHash ?? {}).toEqual({})
    expect(JSON.stringify(session)).not.toContain('never shown')
  } finally {
    h.database.close()
    target.database.close()
  }
})

it('backs up a session with an unreachable fork as rows without that fork', async () => {
  const h = harness()
  try {
    const unreachable: Session = {
      id: 'unreachable',
      name: 'Deleted branch point',
      messages: [{ id: 'visible', role: 'user', contentParts: [{ type: 'text', text: 'visible' }] }],
      messageForksHash: {
        deleted: {
          position: 1,
          createdAt: 1,
          lists: [
            { id: 'saved', messages: [{ id: 'hidden', role: 'assistant', contentParts: [] }] },
            { id: 'active', messages: [] },
          ],
        },
      },
    }
    await h.records.setRecord(unreachable)
    const options = {
      storage: h.storage,
      metaStorage: new MemoryMetaStorage(),
      sessionStore: h.store,
      exportItems: ['conversations'] as ['conversations'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
    }
    const prepared = await prepareBackupExport(options)
    expect(prepared.sessions[0]).not.toHaveProperty('legacyTopology')
    const parts: Uint8Array<ArrayBuffer>[] = []
    const exported = await exportBackupArchive({
      ...options,
      prepared,
      writeArchive: async (stream) => {
        for await (const part of stream()) parts.push(new Uint8Array(part))
        return { boundedMemory: true }
      },
    })
    expect(exported.manifest.sessions[0].legacyTopology).toBeUndefined()
    const entries = unzipSync(new Uint8Array(await new Blob(parts).arrayBuffer()))
    const archived = Object.entries(entries)
      .filter(([path]) => path.startsWith('sessions/'))
      .map(([, data]) => new TextDecoder().decode(data))
      .join('\n')
    expect(archived).toContain('visible')
    expect(archived).not.toContain('hidden')
  } finally {
    h.database.close()
  }
})

it.each(['materialized', 'range'] as const)(
  'backs up sessions whose repairs add or rename messages in %s mode',
  async (mode) => {
    const h = harness()
    try {
      const text = (id: string) => [{ type: 'text' as const, text: id }]
      const sessions: Session[] = [
        {
          id: 'anchored',
          name: 'Leading summary',
          messages: [{ id: 'summary', role: 'user', isSummary: true, contentParts: text('summary') }],
          messageForksHash: {
            summary: {
              position: 1,
              createdAt: 1,
              lists: [
                { id: 'saved', messages: [{ id: 'reply', role: 'assistant', contentParts: text('reply') }] },
                { id: 'active', messages: [] },
              ],
            },
          },
        },
        {
          id: 'repeated',
          name: 'Repeated ids',
          messages: [
            { id: 'same', role: 'user', contentParts: text('first') },
            { id: 'same', role: 'assistant', contentParts: text('second') },
          ],
        },
      ]
      const files = new Map(sessions.map((session) => [session.id, new TextEncoder().encode(JSON.stringify(session))]))
      const source = legacyBackupSource(h.rows, {
        listSessionIds: async () => sessions.map((session) => session.id),
        readValue: async (id) => structuredClone(sessions.find((session) => session.id === id) ?? null),
        open:
          mode === 'range'
            ? async (id) => {
                const bytes = files.get(id)!
                return {
                  size: bytes.length,
                  text: async () => new TextDecoder().decode(bytes),
                  readBytes: async (offset, length) => bytes.slice(offset, offset + length),
                }
              }
            : undefined,
      })
      const options = {
        storage: h.storage,
        metaStorage: new MemoryMetaStorage(),
        sessionStore: source,
        exportItems: ['conversations'] as ['conversations'],
        includeKeys: false,
        application: { version: 'test', platform: 'test' },
      }
      const prepared = await prepareBackupExport(options)
      expect(prepared.warnings).toEqual([])
      expect(prepared.sessions.map((session) => session.id).sort()).toEqual(['anchored', 'repeated'])
      for (const session of prepared.sessions) {
        if (mode === 'range')
          expect(session).toMatchObject({ legacyTopology: expect.stringMatching(/has no source range$/) })
        else expect(session).not.toHaveProperty('legacyTopology')
      }
      const parts: Uint8Array<ArrayBuffer>[] = []
      await exportBackupArchive({
        ...options,
        prepared,
        writeArchive: async (stream) => {
          for await (const part of stream()) parts.push(new Uint8Array(part))
          return { boundedMemory: true }
        },
      })
      const target = new MemoryStorage()
      await importBackupArchive(new Blob(parts), { storage: target, metaStorage: new MemoryMetaStorage() })
      const restored = target.values.get('session:repeated') as Session
      expect(restored.messages.map((message) => message.contentParts)).toEqual([text('first'), text('second')])
      expect(JSON.stringify(target.values.get('session:anchored'))).toContain('"reply"')
    } finally {
      h.database.close()
    }
  }
)

it('backs up a large range-read session that needs renamed messages without failing the other sessions', async () => {
  const h = harness()
  try {
    const text = (id: string) => [{ type: 'text' as const, text: id }]
    const sessions: Session[] = [
      {
        id: 'repeated',
        name: 'Repeated ids',
        messages: [
          { id: 'large', role: 'user', contentParts: text('x'.repeat(4000)) },
          { id: 'same', role: 'user', contentParts: text('first') },
          { id: 'same', role: 'assistant', contentParts: text('second') },
        ],
      },
      { id: 'healthy', name: 'Healthy', messages: [{ id: 'fine', role: 'user', contentParts: text('fine') }] },
    ]
    const files = new Map(sessions.map((session) => [session.id, new TextEncoder().encode(JSON.stringify(session))]))
    const source = legacyBackupSource(h.rows, {
      listSessionIds: async () => sessions.map((session) => session.id),
      open: async (id) => {
        const bytes = files.get(id)!
        return {
          size: bytes.length,
          text: async () => new TextDecoder().decode(bytes),
          readBytes: async (offset, length) => bytes.slice(offset, offset + length),
        }
      },
    })
    const options = {
      storage: h.storage,
      metaStorage: new MemoryMetaStorage(),
      sessionStore: source,
      exportItems: ['conversations'] as ['conversations'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
    }
    const prepared = await prepareBackupExport(options, { singleSessionBytes: 1024 })
    expect(prepared.warnings).toEqual([])
    expect(prepared.sessions.find((session) => session.id === 'repeated')).toMatchObject({
      layout: 'single',
      legacyTopology: 'message same has no source range',
    })
    const parts: Uint8Array<ArrayBuffer>[] = []
    const exported = await exportBackupArchive({
      ...options,
      prepared,
      writeArchive: async (stream) => {
        for await (const part of stream()) parts.push(new Uint8Array(part))
        return { boundedMemory: true }
      },
    })
    expect(exported.manifest.sessions.map((session) => session.id).sort()).toEqual(['healthy', 'repeated'])
  } finally {
    h.database.close()
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
