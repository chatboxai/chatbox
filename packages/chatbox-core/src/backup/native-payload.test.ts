import { createHash } from 'node:crypto'
import type { Session } from '@shared/types'
import { expect, it } from 'vitest'
import { openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import { exportBackupArchive } from './export-backup'
import { importBackupArchive } from './import-backup'
import { projectBackupMessage } from './payload'
import { prepareBackupExport } from './preflight'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import type { BackupFile } from './types'
import { readZipFileEntries } from './zip'

const text = (seed: number, chars: number) => {
  let s = seed >>> 0 || 1
  const parts: string[] = []
  let length = 0
  while (length < chars) {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    const part = `${s % 97 === 0 ? '中🙂"\\\n' : s.toString(36)} `
    parts.push(part)
    length += part.length
  }
  return parts.join('')
}

const session: Session = {
  id: 's',
  name: 'S',
  messages: [
    {
      id: 'm0',
      role: 'user',
      contentParts: [{ type: 'text', text: text(1, 300 * 1024) }],
      files: [
        {
          id: 'f',
          name: 'paper.txt',
          fileType: 'text/plain',
          storageKey: 'file-key',
          rawStorageKey: 'raw-key',
          localPath: '/private/tmp/paper.txt',
          ragMode: 'session-retrieval',
          sessionAttachmentId: 4,
          sessionAttachmentIndexStatus: 'ready',
        },
      ],
    },
    { id: 'm1', role: 'assistant', contentParts: [{ type: 'text', text: text(2, 700 * 1024) }] },
    { id: 'm2', role: 'assistant', contentParts: [{ type: 'text', text: 'short' }] },
  ],
}
const source = () => contextSnapshot(session as Parameters<typeof contextSnapshot>[0])

const blobs = () => {
  const storage = new MemoryStorage()
  storage.blobs.set('file-key', 'parsed text')
  storage.blobs.set('raw-key', 'data:text/plain;base64,aGVsbG8=')
  return storage
}

async function exportWith(nativePayloadLimit: number) {
  const db = openNodeSessionRowDatabase()
  const rows = new SqlSessionRowStore(db)
  await rows.writeRows(source())
  const metaStorage = new MemoryMetaStorage()
  await metaStorage.create({ id: 's', name: 'S', sortOrder: 1, createdAt: 1 })
  const options = {
    sessionStore: rows,
    storage: blobs(),
    metaStorage,
    exportItems: ['conversations'] as ['conversations'],
    includeKeys: false,
    application: { version: 'test', platform: 'test' },
    exportedAt: new Date(0),
    nativePayloadLimit,
  }
  const prepared = await prepareBackupExport(options, { singleSessionBytes: 64 * 1024 })
  const parts: Uint8Array[] = []
  const result = await exportBackupArchive({
    ...options,
    prepared,
    writeArchive: async (stream) => {
      for await (const part of stream()) parts.push(new Uint8Array(part))
      return { boundedMemory: true }
    },
  })
  db.close()
  const bytes = new Uint8Array(Buffer.concat(parts))
  const entries = new Map<string, string>()
  const contents = new Map<string, Uint8Array>()
  const file: BackupFile = {
    size: bytes.length,
    readBytes: async (offset, length) => bytes.slice(offset, offset + length),
    async *chunks() {
      yield bytes
    },
    text: async () => Buffer.from(bytes).toString(),
  }
  await readZipFileEntries(file, async (entry) => {
    entries.set(entry.path, createHash('sha256').update(entry.data).digest('hex'))
    contents.set(entry.path, entry.data)
  })
  return { prepared, result, file, entries, contents }
}

async function importWith(file: BackupFile, nativePayloadLimit: number) {
  const db = openNodeSessionRowDatabase()
  const rows = new SqlSessionRowStore(db)
  await importBackupArchive(file, {
    storage: new MemoryStorage(),
    metaStorage: new MemoryMetaStorage(),
    sharded: { store: rows, nativePayloadLimit },
  })
  const snapshot = await rows.readSnapshot('s')
  db.close()
  if (!snapshot) throw new Error('Session was not restored')
  return snapshot
}

function explain(a: Awaited<ReturnType<typeof exportWith>>, b: Awaited<ReturnType<typeof exportWith>>) {
  for (const [path, hash] of a.entries) {
    if (b.entries.get(path) === hash) continue
    const x = a.contents.get(path) ?? new Uint8Array()
    const y = b.contents.get(path) ?? new Uint8Array()
    let i = 0
    while (i < x.length && i < y.length && x[i] === y[i]) i++
    const d = new TextDecoder()
    console.log(
      `DIFF ${path} sizes ${x.length}/${y.length} at ${i}: ${JSON.stringify(d.decode(x.subarray(Math.max(0, i - 40), i + 60)))} vs ${JSON.stringify(d.decode(y.subarray(Math.max(0, i - 40), i + 60)))}`
    )
  }
}

it('produces the same archive whether payloads are materialized natively or streamed', async () => {
  const native = await exportWith(8 * 1024 * 1024)
  const streamed = await exportWith(0)
  expect(native.prepared).toEqual(streamed.prepared)
  expect(native.prepared.formatVersion).toBe(3)
  const first = native.result.manifest.sessions[0]
  expect('payloads' in first && first.payloads.length).toBeGreaterThan(0)
  explain(native, streamed)
  expect([...native.entries.entries()]).toEqual([...streamed.entries.entries()])
}, 60_000)

it('restores the same rows whether payload groups are rebuilt natively or streamed', async () => {
  const { file } = await exportWith(8 * 1024 * 1024)
  const native = await importWith(file, 8 * 1024 * 1024)
  const streamed = await importWith(file, 0)
  expect(native.rows).toEqual(streamed.rows)
  const restored = native.rows.messages.find((message) => message.messageId === 'm0')
  expect(restored?.message.files?.[0]).toMatchObject({
    storageKey: 'file-key',
    rawStorageKey: 'raw-key',
    ragMode: 'inline',
  })
  expect(restored?.message.files?.[0]).not.toHaveProperty('localPath')
  expect(restored?.message.files?.[0]).not.toHaveProperty('sessionAttachmentId')
}, 60_000)

it('mixes native and streamed payloads inside one session by size', async () => {
  const mixed = await exportWith(400 * 1024)
  const streamed = await exportWith(0)
  explain(mixed, streamed)
  expect([...mixed.entries.entries()]).toEqual([...streamed.entries.entries()])
  const rows = await importWith(mixed.file, 400 * 1024)
  expect(rows.rows.messages.map((message) => message.messageId).sort()).toEqual(['m0', 'm1', 'm2'])
}, 60_000)

it('projects materialized messages with the validator string limits', () => {
  const projected = projectBackupMessage({
    id: 'm',
    role: 'user',
    contentParts: [{ type: 'text', text: 'x'.repeat(5000) }],
    files: [{ id: 'f', name: 'n', fileType: 't', storageKey: 'k'.repeat(5000), rawStorageKey: 'r'.repeat(32768) }],
  })
  expect((projected.contentParts[0] as { text: string }).text).toHaveLength(4096)
  expect(projected.files?.[0].storageKey).toHaveLength(5000)
  expect(projected.files?.[0].rawStorageKey).toHaveLength(32768)
})

it('rejects resource identifiers that cannot be retained in full', () => {
  expect(() =>
    projectBackupMessage({
      id: 'm',
      role: 'user',
      contentParts: [],
      files: [{ id: 'f', name: 'n', fileType: 't', rawStorageKey: 'r'.repeat(32769) }],
    })
  ).toThrow('Backup resource identifier exceeds budget')
})
