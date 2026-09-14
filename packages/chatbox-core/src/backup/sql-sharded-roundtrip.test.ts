import { decodeSessionTree } from '../session/session-tree/decode'
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { openNodeSessionRowDatabase, type NodeSessionRowSqlDatabase } from '../persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import { contextSession, contextSnapshot } from '../persistence/session-context-read.test-support'
import { exportBackupArchive } from './export-backup'
import { importBackupArchive } from './import-backup'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import { unzipSync, zipSync } from 'fflate'
import { sha256Checksum } from './codec'
import { readZipFileEntries, createZipStream } from './zip'
import { DEFAULT_BACKUP_PAGE_LIMITS } from './session-port'
import { SessionRowConflictError } from '../ports/session-row-store'
import type { MessageRow } from '../session/session-tree/types'

async function collect(stream: AsyncIterable<Uint8Array>) {
  const parts: Uint8Array<ArrayBuffer>[] = []
  for await (const part of stream) parts.push(new Uint8Array(part))
  return new Blob(parts)
}
async function backup(source: SqlSessionRowStore) {
  let archive = new Blob()
  await exportBackupArchive({
    storage: new MemoryStorage(),
    metaStorage: new MemoryMetaStorage(),
    exportItems: ['conversations'],
    includeKeys: false,
    application: { version: 'test', platform: 'test' },
    sharded: { store: source },
    writeArchive: async (stream) => {
      archive = await collect(stream())
      return { boundedMemory: true }
    },
  })
  return archive
}

const databases: NodeSessionRowSqlDatabase[] = []
function fixture() {
  return {
    ...contextSession(),
    threads: ['\ue000', '\u{10000}'].map((id, index) => ({
      id,
      name: `Archived ${index}`,
      createdAt: index,
      messages: [{ id: `archive-${index}`, role: 'user' as const, contentParts: [] }],
    })),
    messageForksHash: {
      system: {
        position: 1,
        createdAt: 42,
        lists: [
          { id: 'alternate', messages: [{ id: 'alternative', role: 'assistant' as const, contentParts: [] }] },
          { id: 'selected', messages: [] },
        ],
      },
    },
  }
}
function store() {
  const db = openNodeSessionRowDatabase()
  databases.push(db)
  return new SqlSessionRowStore(db)
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const db of databases.splice(0)) db.close()
})

it('cleans a cancelled SQL payload without deleting another candidate pending payload', async () => {
  const target = store()
  const snapshot = contextSnapshot({
    id: 'pending',
    name: 'Pending',
    messages: [{ id: 'body', role: 'user', contentParts: [{ type: 'text', text: 'kept' }] }],
  })
  const first = await target.beginBackupRestore(snapshot.record.id)
  const second = await target.beginBackupRestore(snapshot.record.id)
  const data = new TextEncoder().encode(JSON.stringify(snapshot.rows.messages[0].message))
  for (const candidate of [first, second]) {
    await candidate.append({ kind: 'header', record: snapshot.record })
    for (const thread of snapshot.rows.threads) await candidate.append({ kind: 'thread', thread })
    await candidate.appendPayload!(data.subarray(0, 7))
  }
  await first.dispose()
  await second.appendPayload!(data.subarray(7))
  await second.append({ kind: 'message', message: snapshot.rows.messages[0], payload: { size: data.length } })
  await second.publish()
  await second.dispose()
  expect((await target.readSnapshot(snapshot.record.id))?.rows).toEqual(snapshot.rows)
})

it('round trips a SQL message larger than a shard and preserves Unicode, escaped and mixed fields', async () => {
  const source = store()
  const target = store()
  const text = '🙂中\\\"\n'.repeat(50_000)
  const original = contextSnapshot({
    id: 'large-message',
    name: 'Large message',
    messages: [
      {
        id: 'large',
        role: 'user',
        contentParts: [{ type: 'text', text }],
        reasoningContent: text,
        errorExtra: { nested: [text, { small: 'kept' }] },
      },
    ],
  })
  await source.writeRows(original)
  const archive = await backup(source)
  await importBackupArchive(archive, {
    storage: new MemoryStorage(),
    metaStorage: new MemoryMetaStorage(),
    sharded: { store: target },
  })
  const restored = await target.readSnapshot(original.record.id)
  expect(restored?.rows).toEqual(original.rows)
  if (!restored) throw new Error('Missing restored message')
  const message = restored.rows.messages[0]
  message.message.contentParts = [{ type: 'text', text: 'Edited after restore' }]
  await target.applyDiff(
    { sessionId: original.record.id, threads: { upsert: [], delete: [] }, messages: { upsert: [message], delete: [] } },
    { record: restored.record, revision: restored.revision + 1 },
    restored.revision
  )
  expect((await target.readSnapshot(original.record.id))?.rows.messages[0].message.contentParts).toEqual(
    message.message.contentParts
  )
})

it.each(['json', 'utf8', 'missing', 'identity', 'bom'] as const)(
  'rejects a %s-damaged message payload before changing existing data',
  async (damage) => {
    const source = store()
    const target = store()
    const original = contextSnapshot({
      id: 'payload-damage',
      name: 'Payload',
      messages: [{ id: 'big', role: 'user', contentParts: [{ type: 'text', text: 'x'.repeat(400_000) }] }],
    })
    await source.writeRows(original)
    const old = contextSnapshot({
      id: original.record.id,
      name: 'Old',
      messages: [{ id: 'old', role: 'user', contentParts: [] }],
    })
    await target.writeRows(old)
    const archive = unzipSync(new Uint8Array(await (await backup(source)).arrayBuffer()))
    const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json']))
    const block = manifest.sessions[0].payloads[0]
    if (damage === 'missing') delete archive[block.path]
    else {
      if (damage === 'bom') {
        archive[block.path] = new TextEncoder().encode(
          '\ufeff' + new TextDecoder().decode(archive[block.path]).replace('xxx', '')
        )
      }
      if (damage === 'json') archive[block.path][0] = 91
      if (damage === 'utf8') archive[block.path][0] = 255
      if (damage === 'identity')
        archive[block.path] = new TextEncoder().encode(
          new TextDecoder().decode(archive[block.path]).replace('"big"', '"bad"')
        )
      block.checksum = await sha256Checksum(archive[block.path])
    }
    archive['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    await expect(
      importBackupArchive(new Blob([new Uint8Array(zipSync(archive))]), {
        storage: new MemoryStorage(),
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: target },
      })
    ).rejects.toThrow()
    expect((await target.readSnapshot(old.record.id))?.rows).toEqual(old.rows)
  }
)

it('bounds the structure retained while exporting a message with many long object keys', async () => {
  const source = store()
  await source.writeRows(
    contextSnapshot({
      id: 'long-keys',
      name: 'Long keys',
      messages: [
        {
          id: 'keys',
          role: 'user',
          contentParts: [],
          errorExtra: Object.fromEntries(
            Array.from({ length: 200 }, (_, index) => [`${index}${'k'.repeat(1000)}`, null])
          ),
        },
      ],
    })
  )
  await expect(backup(source)).rejects.toThrow('Backup message structure exceeds budget')
})

it.skipIf(process.env.RUN_LARGE_BACKUP !== '1')(
  'round trips one 128 MiB SQL body through bounded payload blocks',
  async () => {
    const source = store()
    const target = store()
    const fixture = contextSnapshot({
      id: 'huge-body',
      name: 'Huge',
      messages: [{ id: 'huge', role: 'user', contentParts: [{ type: 'text', text: '' }] }],
    })
    const candidate = await source.beginBackupRestore(fixture.record.id)
    await candidate.append({ kind: 'header', record: fixture.record })
    for (const thread of fixture.rows.threads) await candidate.append({ kind: 'thread', thread })
    const prefix = new TextEncoder().encode('{"id":"huge","role":"user","contentParts":[{"type":"text","text":"')
    const suffix = new TextEncoder().encode('"}]}')
    const block = new TextEncoder().encode('a'.repeat(64 * 1024))
    const expected = createHash('sha256')
    const add = async (bytes: Uint8Array) => {
      expected.update(bytes)
      await candidate.appendPayload!(bytes)
    }
    await add(prefix)
    for (let i = 0; i < 2048; i++) await add(block)
    await add(suffix)
    const size = 128 * 1024 * 1024 + prefix.length + suffix.length
    await candidate.append({ kind: 'message', message: fixture.rows.messages[0], payload: { size } })
    await candidate.publish()
    await candidate.dispose()
    let maxResponseBytes = 0
    let maxStatementBytes = 0
    for (const db of databases) {
      const query = db.query.bind(db)
      vi.spyOn(db, 'query').mockImplementation(async (sql, params) => {
        const result = await query(sql, params)
        maxResponseBytes = Math.max(maxResponseBytes, new TextEncoder().encode(JSON.stringify(result)).length)
        return result
      })
      const execute = db.executeBatch.bind(db)
      vi.spyOn(db, 'executeBatch').mockImplementation((statements, options) =>
        execute(
          (function* () {
            for (const statement of statements) {
              maxStatementBytes = Math.max(
                maxStatementBytes,
                new TextEncoder().encode(JSON.stringify(statement)).length
              )
              yield statement
            }
          })(),
          options
        )
      )
    }
    const archive = await backup(source)
    await importBackupArchive(archive, {
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      sharded: { store: target },
    })
    const actual = createHash('sha256')
    let restoredBytes = 0
    for await (const row of target.iterateBackupRows(fixture.record.id, DEFAULT_BACKUP_PAGE_LIMITS)) {
      if (row.kind !== 'message') continue
      expect(row.message.messageId).toBe('huge')
      if (!row.payload?.chunks) throw new Error('Missing payload source')
      for await (const bytes of row.payload.chunks()) {
        actual.update(bytes)
        restoredBytes += bytes.length
        expect(bytes.length).toBeLessThanOrEqual(128 * 1024)
      }
    }
    expect(restoredBytes).toBe(size)
    expect(actual.digest('hex')).toBe(expected.digest('hex'))
    expect(maxResponseBytes).toBeLessThan(384 * 1024)
    expect(maxStatementBytes).toBeLessThan(384 * 1024)
    process.stdout.write(
      JSON.stringify({
        bodyBytes: 128 * 1024 * 1024,
        restoredBytes,
        archiveBytes: archive.size,
        maxResponseBytes,
        maxStatementBytes,
      }) + '\n'
    )
  },
  120_000
)

it('round trips every SQL thread and branch through the public ZIP backup entry points', async () => {
  const source = store()
  const target = store()
  const original = contextSnapshot(fixture())
  await source.writeRows(original)
  const storage = new MemoryStorage()
  const metaStorage = new MemoryMetaStorage()
  let archive = new Blob()
  const exported = await exportBackupArchive({
    storage,
    metaStorage,
    exportItems: ['conversations'],
    includeKeys: false,
    selectedSessionIds: [original.record.id],
    application: { version: 'test', platform: 'test' },
    sharded: { store: source, limits: { maxPageRows: 2, maxPageBytes: 8192, maxRecordBytes: 4096 } },
    writeArchive: async (stream) => {
      const parts: Uint8Array<ArrayBuffer>[] = []
      for await (const part of stream()) parts.push(new Uint8Array(part))
      archive = new Blob(parts)
      return { boundedMemory: true }
    },
  })
  expect(exported.manifest.formatVersion).toBe(3)
  await importBackupArchive(archive, { storage, metaStorage, sharded: { store: target } })
  const restored = await target.readSnapshot(original.record.id)
  expect(restored?.rows).toEqual(original.rows)
  expect(restored?.record.activeThreadId).toBe(original.record.activeThreadId)
  expect(restored?.record.forkCreatedAt).toEqual(original.record.forkCreatedAt)
  if (!restored) throw new Error('Restored snapshot is missing')
  const decoded = decodeSessionTree({ session: restored.record, ...restored.rows })
  expect(decoded.ok).toBe(true)
  if (decoded.ok) {
    expect(decoded.session.messages.map((message) => message.id)).toEqual(
      fixture().messages.map((message) => message.id)
    )
    expect(decoded.session.messageForksHash).toEqual(fixture().messageForksHash)
  }
})

it.each(['checksum', 'missing', 'order', 'count', 'parent', 'summary-branch'] as const)(
  'rejects a %s-damaged archive before overwriting the same SQL session',
  async (damage) => {
    const source = store()
    const target = store()
    const original = contextSnapshot(fixture())
    await source.writeRows(original)
    const old = contextSnapshot({
      id: original.record.id,
      name: 'Keep me',
      messages: [{ id: 'old', role: 'user', contentParts: [{ type: 'text', text: 'Existing body' }] }],
    })
    await target.writeRows(old)
    const archive = unzipSync(new Uint8Array(await (await backup(source)).arrayBuffer()))
    const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json']))
    const shard = manifest.sessions[0].shards.find((entry: { kind: string }) => entry.kind === 'message')
    if (damage === 'missing') delete archive[shard.path]
    else if (damage === 'checksum') archive[shard.path][10] ^= 1
    else if (damage === 'count') shard.count++
    else {
      const messages = JSON.parse(new TextDecoder().decode(archive[shard.path]))
      if (damage === 'order') messages.reverse()
      else if (damage === 'parent') messages[0].parentId = 'missing-parent'
      else {
        messages[0].role = 'summary'
        messages[0].value.isSummary = true
      }
      archive[shard.path] = new TextEncoder().encode(JSON.stringify(messages))
      shard.size = archive[shard.path].length
      shard.checksum = await sha256Checksum(archive[shard.path])
    }
    archive['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    await expect(
      importBackupArchive(new Blob([new Uint8Array(zipSync(archive))]), {
        storage: new MemoryStorage(),
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: target },
      })
    ).rejects.toThrow()
    expect((await target.readSnapshot(old.record.id))?.rows).toEqual(old.rows)
  }
)

it('clears absent metadata fields and preserves the old SQL body when candidate publication fails', async () => {
  const source = store()
  const target = store()
  const original = contextSnapshot(contextSession())
  await source.writeRows(original)
  const old = contextSnapshot({ id: original.record.id, name: 'Original', messages: [] })
  await target.writeRows(old)
  const metaStorage = new MemoryMetaStorage()
  await metaStorage.create({
    id: old.record.id,
    name: 'Original',
    sortOrder: 0,
    createdAt: 1,
    hidden: true,
    archivedAt: 20,
  })
  const archive = await backup(source)
  const publish = vi.spyOn(target, 'beginBackupRestore')
  publish.mockImplementationOnce(async (id) => {
    const candidate = await SqlSessionRowStore.prototype.beginBackupRestore.call(target, id)
    return {
      ...candidate,
      publish: async () => {
        throw new Error('Candidate publish failed')
      },
    }
  })
  await expect(
    importBackupArchive(archive, { storage: new MemoryStorage(), metaStorage, sharded: { store: target } })
  ).rejects.toThrow('Candidate publish failed')
  expect((await target.readSnapshot(old.record.id))?.rows).toEqual(old.rows)
  expect(await metaStorage.getById(old.record.id)).toMatchObject({ hidden: true, archivedAt: 20 })
  publish.mockRestore()
  await importBackupArchive(archive, { storage: new MemoryStorage(), metaStorage, sharded: { store: target } })
  expect((await metaStorage.getById(old.record.id))?.hidden).toBeUndefined()
  expect((await metaStorage.getById(old.record.id))?.archivedAt).toBeUndefined()
})

it('rolls back published rows and removes new metadata fields when metadata publication fails', async () => {
  const source = store()
  const target = store()
  await source.writeRows(contextSnapshot({ ...contextSession(), hidden: true, archivedAt: 80 }))
  const old = contextSnapshot({ id: 'context-session', name: 'Original', messages: [] })
  await target.writeRows(old)
  const metaStorage = new MemoryMetaStorage()
  await metaStorage.create({ id: old.record.id, name: 'Original', sortOrder: 0, createdAt: 1 })
  const update = vi.spyOn(metaStorage, 'update')
  update.mockImplementationOnce(async (id, value) => {
    await MemoryMetaStorage.prototype.update.call(metaStorage, id, value)
    throw new Error('Metadata write failed')
  })
  await expect(
    importBackupArchive(await backup(source), { storage: new MemoryStorage(), metaStorage, sharded: { store: target } })
  ).rejects.toThrow('Metadata write failed')
  expect((await target.readSnapshot(old.record.id))?.rows).toEqual(old.rows)
  expect((await metaStorage.getById(old.record.id))?.hidden).toBeUndefined()
  expect((await metaStorage.getById(old.record.id))?.archivedAt).toBeUndefined()
})

it('keeps rollback material when rollback itself fails', async () => {
  const source = store()
  const target = store()
  await source.writeRows(contextSnapshot(contextSession()))
  const dispose = vi.fn(async () => {})
  const begin = vi.spyOn(target, 'beginBackupRestore')
  begin.mockImplementationOnce(async (id) => {
    const candidate = await SqlSessionRowStore.prototype.beginBackupRestore.call(target, id)
    return {
      ...candidate,
      publish: async () => {
        throw new Error('Publication failed')
      },
      rollback: async () => {
        throw new Error('Rollback failed')
      },
      dispose,
    }
  })
  await expect(
    importBackupArchive(await backup(source), {
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      sharded: { store: target },
    })
  ).rejects.toThrow('Backup restore or cleanup failed')
  expect(dispose).not.toHaveBeenCalled()
})

it('accepts historical v2 resources above the v3 page budget through the same public importer', async () => {
  const storage = new MemoryStorage()
  const metaStorage = new MemoryMetaStorage()
  await storage.setItemNow('session:v2', {
    id: 'v2',
    name: 'Legacy',
    messages: [
      { id: 'v2-message', role: 'user', contentParts: [{ type: 'text', text: 'historical text '.repeat(50000) }] },
    ],
  })
  await storage.setItemNow('settings', { language: 'en', customValue: 'x'.repeat(600 * 1024) })
  let archive = new Blob()
  await exportBackupArchive({
    storage,
    metaStorage,
    exportItems: ['setting', 'conversations'],
    includeKeys: false,
    application: { version: 'test', platform: 'test' },
    writeArchive: async (stream) => {
      archive = await collect(stream())
      return { boundedMemory: true }
    },
  })
  const restored = new MemoryStorage()
  const result = await importBackupArchive(archive, {
    storage: restored,
    metaStorage: new MemoryMetaStorage(),
    sharded: { store: store() },
  })
  expect(result.manifest.formatVersion).toBe(2)
  expect(await restored.getItem('session:v2', null)).toEqual(await storage.getItem('session:v2', null))
})

it('rejects a thread or message larger than the injected record budget', async () => {
  const source = store()
  await source.writeRows(contextSnapshot(contextSession()))
  await expect(
    exportBackupArchive({
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      exportItems: ['conversations'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
      sharded: { store: source, limits: { maxRecordBytes: 1024, maxPageBytes: 2048, maxPageRows: 2 } },
      writeArchive: async (stream) => {
        await collect(stream())
        return { boundedMemory: true }
      },
    })
  ).rejects.toThrow(/budget|payload blocks/)
})

it('accepts a historical v2 manifest larger than the v3 manifest budget', async () => {
  const manifest = {
    format: 'chatbox-backup',
    formatVersion: 2,
    exportedAt: new Date(0).toISOString(),
    application: { name: 'Chatbox', version: '1.22', platform: 'test' },
    exportItems: ['conversations'],
    data: {},
    sessions: [],
    resources: [],
    warnings: [{ code: 'session-read-failed', itemType: 'session', message: 'x'.repeat(4 * 1024 * 1024) }],
    stats: { sessionCount: 0, resourceCount: 0, deduplicatedResourceCount: 0, warningCount: 1 },
  }
  const file = new Blob([
    new Uint8Array(zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) })),
  ])
  const result = await importBackupArchive(file, {
    storage: new MemoryStorage(),
    metaStorage: new MemoryMetaStorage(),
    sharded: { store: store() },
  })
  expect(result.manifest.formatVersion).toBe(2)
  expect(result.warnings).toHaveLength(1)
})

it.skipIf(process.env.RUN_LARGE_BACKUP !== '1')(
  'round trips a 132 MiB SQL conversation in bounded batches',
  async () => {
    const source = store()
    const target = store()
    const count = 2112
    const text = 'ordinary message '.repeat(4096).slice(0, 65536)
    const original = contextSnapshot({ ...fixture(), id: 'large/session.132', name: 'Large' })
    const thread = {
      ...original.rows.threads[0],
      rootMessageId: original.rows.threads[0].rootMessageId,
      activeLeafMessageId: `m${count - 1}`,
    }
    const baseSequence =
      Math.max(
        ...original.rows.messages
          .filter((message) => message.threadId === thread.threadId)
          .map((message) => message.seq)
      ) + 1
    await source.writeRows({
      ...original,
      rows: {
        ...original.rows,
        threads: [thread, ...original.rows.threads.slice(1)],
        messages: original.rows.messages.map((message) =>
          message.messageId === 'target' ? { ...message, activeChildId: 'm0' } : message
        ),
      },
    })
    let revision = 1
    for (let start = 0; start < count; start += 16) {
      const messages: MessageRow[] = Array.from({ length: Math.min(16, count - start) }, (_, offset) => {
        const index = start + offset
        return {
          sessionId: original.record.id,
          threadId: thread.threadId,
          messageId: `m${index}`,
          seq: baseSequence + index,
          parentMessageId: index ? `m${index - 1}` : 'target',
          activeChildId: index === count - 1 ? null : `m${index + 1}`,
          kind: 'message',
          status: 'settled',
          branchId: null,
          createdAt: 1,
          updatedAt: 1,
          message: { id: `m${index}`, role: 'user', contentParts: [{ type: 'text', text }] },
        }
      })
      await source.applyDiff(
        {
          sessionId: original.record.id,
          threads: { upsert: [], delete: [] },
          messages: { upsert: messages, delete: [] },
        },
        { record: original.record, revision: revision + 1 },
        revision
      )
      revision++
      databases[0].reset()
    }
    const archive = await backup(source)
    await importBackupArchive(archive, {
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      sharded: { store: target },
    })
    let restored = 0
    let payloadBytes = 0
    for await (const row of target.iterateBackupRows(original.record.id, DEFAULT_BACKUP_PAGE_LIMITS)) {
      if (row.kind !== 'message') continue
      if (!/^m\d+$/.test(row.message.messageId)) {
        const expected = original.rows.messages.find((message) => message.messageId === row.message.messageId)
        expect(row.message).toEqual(expected?.messageId === 'target' ? { ...expected, activeChildId: 'm0' } : expected)
        continue
      }
      expect(row.message.messageId).toBe(`m${restored}`)
      expect(row.message.message.contentParts).toEqual([{ type: 'text', text }])
      restored++
      payloadBytes += text.length
    }
    expect(restored).toBe(count)
    expect(payloadBytes).toBe(132 * 1024 * 1024)
    process.stdout.write(
      JSON.stringify({
        payloadBytes,
        archiveBytes: archive.size,
        restored,
        pageBudget: DEFAULT_BACKUP_PAGE_LIMITS.maxPageBytes,
      }) + '\n'
    )
  },
  300_000
)

it('keeps at most one inflated entry while a high-compression consumer is paused', async () => {
  const size = 256 * 1024
  const entries = Array.from({ length: 64 }, (_, index) => ({ path: `part-${index}.bin`, data: new Uint8Array(size) }))
  const archive = await collect(createZipStream(entries))
  let active = 0
  let count = 0
  let peak = 0
  await readZipFileEntries(
    archive,
    async (entry) => {
      expect(active++).toBe(0)
      expect(entry.data.length).toBe(size)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      count++
    },
    {
      bounded: true,
      onBufferedBytes: (bytes) => {
        peak = Math.max(peak, bytes)
      },
    }
  )
  expect(count).toBe(64)
  expect(peak).toBeLessThanOrEqual(size)
})

it('rejects a revision change between complete-tree pages', async () => {
  const source = store()
  const original = contextSnapshot(contextSession())
  await source.writeRows(original)
  const rows = source.iterateBackupRows(original.record.id, DEFAULT_BACKUP_PAGE_LIMITS)[Symbol.asyncIterator]()
  await rows.next()
  await source.writeRows({ ...original, revision: 2 }, 1)
  await expect(rows.next()).rejects.toBeInstanceOf(SessionRowConflictError)
})
