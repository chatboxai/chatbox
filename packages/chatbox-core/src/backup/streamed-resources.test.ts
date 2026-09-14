import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { exportBackupArchive } from './export-backup'
import { importBackupArchive } from './import-backup'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import { openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { unzipSync, zipSync } from 'fflate'

class StreamStorage extends MemoryStorage {
  largestWrite = 0
  readonly blobStreams = {
    has: async (key: string) => this.blobs.has(key),
    read: async (key: string): Promise<AsyncIterable<string> | null> => {
      const value = this.blobs.get(key)
      if (value === undefined) return null
      return (async function* () {
        for (let offset = 0; offset < value.length; offset += 4093) yield value.slice(offset, offset + 4093)
      })()
    },
    write: async (key: string, source: AsyncIterable<string>) => {
      if (this.blobs.has(key)) throw new Error('Refusing to overwrite an existing blob')
      const parts: string[] = []
      for await (const part of source) {
        this.largestWrite = Math.max(this.largestWrite, part.length)
        await Promise.resolve()
        parts.push(part)
      }
      this.blobs.set(key, parts.join(''))
    },
  }
  override getBlob(): Promise<string | null> {
    throw new Error('Whole-resource reads are unavailable')
  }
  override setBlob(): Promise<void> {
    throw new Error('Whole-resource writes are unavailable')
  }
}

it('round trips a v2 shared image through bounded resource streams and preserves conflicting target content', async () => {
  const source = new StreamStorage()
  const destination = new StreamStorage()
  const image = `data:image/png;base64,${Buffer.from('image bytes'.repeat(70_000)).toString('base64')}`
  source.blobs.set('image', image)
  source.blobs.set('same-image', image)
  destination.blobs.set('image', 'unrelated target bytes')
  for (const [id, storageKey] of [
    ['first', 'image'],
    ['second', 'same-image'],
  ]) {
    const session: Session = {
      id,
      name: id,
      messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'image', storageKey }] }],
    }
    source.values.set(`session:${id}`, session)
  }
  let archive = new Blob()
  const exported = await exportBackupArchive({
    storage: source,
    metaStorage: new MemoryMetaStorage(),
    exportItems: ['conversations'],
    includeKeys: false,
    application: { version: 'test', platform: 'test' },
    writeArchive: async (stream) => {
      const parts: Uint8Array<ArrayBuffer>[] = []
      for await (const part of stream()) {
        await Promise.resolve()
        parts.push(new Uint8Array(part))
      }
      archive = new Blob(parts)
      return { boundedMemory: true }
    },
  })
  expect(exported.manifest.resources).toHaveLength(1)
  expect(exported.manifest.resources[0]).toMatchObject({
    originalStorageKeys: ['image', 'same-image'],
    sessionIds: ['first', 'second'],
    scope: 'shared',
  })
  expect(exported.manifest.resources[0].checksum.value).toBe(
    createHash('sha256').update('image bytes'.repeat(70_000)).digest('hex')
  )
  const restored = await importBackupArchive(archive, { storage: destination, metaStorage: new MemoryMetaStorage() })
  expect(restored.restoredSessionCount).toBe(2)
  expect(destination.blobs.get('image')).toBe('unrelated target bytes')
  for (const id of ['first', 'second']) {
    const session = destination.values.get(`session:${id}`) as Session
    const part = session.messages[0].contentParts[0]
    if (part.type !== 'image') throw new Error('Image reference was lost')
    expect(destination.blobs.get(part.storageKey)).toBe(image)
  }
  expect(destination.largestWrite).toBeLessThanOrEqual(65536)
  expect([...destination.blobs.keys()].some((key) => key.startsWith('__chatbox_backup_import:'))).toBe(false)
})

it.each(['v2', 'v3'] as const)(
  'keeps a declared missing image unavailable when restoring %s over a conflicting blob key',
  async (format) => {
    const sourceDb = openNodeSessionRowDatabase()
    const targetDb = openNodeSessionRowDatabase()
    try {
      const sourceRows = new SqlSessionRowStore(sourceDb)
      const targetRows = new SqlSessionRowStore(targetDb)
      const source = new StreamStorage()
      const target = new StreamStorage()
      const session: Session = {
        id: 'missing',
        name: 'Missing',
        messages: [
          {
            id: 'm',
            role: 'user',
            contentParts: [
              { type: 'text', text: 'Retained conversation' },
              { type: 'image', storageKey: 'missing-image' },
            ],
          },
        ],
      }
      source.values.set('session:missing', session)
      await sourceRows.writeRows(contextSnapshot(session))
      target.blobs.set('missing-image', 'unrelated target image')
      let archive = new Blob()
      const exported = await exportBackupArchive({
        storage: source,
        metaStorage: new MemoryMetaStorage(),
        exportItems: ['conversations'],
        includeKeys: false,
        sharded: format === 'v3' ? { store: sourceRows } : undefined,
        application: { version: 'test', platform: 'test' },
        writeArchive: async (stream) => {
          const parts: Uint8Array<ArrayBuffer>[] = []
          for await (const part of stream()) parts.push(new Uint8Array(part))
          archive = new Blob(parts)
          return { boundedMemory: true }
        },
      })
      expect(exported.manifest.warnings).toContainEqual(
        expect.objectContaining({ code: 'resource-read-failed', itemId: 'missing-image' })
      )
      await importBackupArchive(archive, {
        storage: target,
        metaStorage: new MemoryMetaStorage(),
        sharded: format === 'v3' ? { store: targetRows } : undefined,
      })
      const message =
        format === 'v3'
          ? (await targetRows.readSnapshot(session.id))!.rows.messages[0].message
          : (target.values.get('session:missing') as Session).messages[0]
      expect(message.contentParts[0]).toEqual(session.messages[0].contentParts[0])
      const image = message.contentParts[1]
      expect(image?.type).toBe('image')
      if (image.type !== 'image') throw new Error('Unavailable image placeholder missing')
      expect(image.storageKey).not.toBe('missing-image')
      expect(target.blobs.has(image.storageKey)).toBe(false)
      expect(target.blobs.get('missing-image')).toBe('unrelated target image')
      const invalid = unzipSync(new Uint8Array(await archive.arrayBuffer()))
      const manifest = JSON.parse(new TextDecoder().decode(invalid['manifest.json']))
      manifest.warnings = []
      manifest.stats.warningCount = 0
      invalid['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
      await expect(
        importBackupArchive(new Blob([new Uint8Array(zipSync(invalid))]), {
          storage: target,
          metaStorage: new MemoryMetaStorage(),
          sharded: format === 'v3' ? { store: targetRows } : undefined,
        })
      ).rejects.toThrow(/resource|declared/i)
    } finally {
      sourceDb.close()
      targetDb.close()
    }
  }
)

it('restores v3 resources referenced after a huge message string without changing its text', async () => {
  const sourceDb = openNodeSessionRowDatabase()
  const targetDb = openNodeSessionRowDatabase()
  try {
    const sourceRows = new SqlSessionRowStore(sourceDb)
    const targetRows = new SqlSessionRowStore(targetDb)
    const source = new StreamStorage()
    const target = new StreamStorage()
    const text = 'image🙂\\"\n'.repeat(40_000)
    const original = contextSnapshot({
      id: 'resource-payload',
      name: 'Resources',
      messages: [
        {
          id: 'm',
          role: 'user',
          contentParts: [
            { type: 'text', text },
            { type: 'image', storageKey: 'image' },
            {
              type: 'tool-call',
              toolCallId: 'tool',
              toolName: 'read',
              args: { storageKey: 'image', value: text },
              state: 'result',
              result: 'large result',
              resultStorageKey: 'result',
            },
          ],
          files: [
            {
              id: 'f',
              name: 'report.pdf',
              fileType: 'application/pdf',
              storageKey: 'parsed',
              rawStorageKey: 'raw',
              localPath: '/private/report.pdf',
              ragMode: 'session-retrieval',
              sessionAttachmentId: 19,
              sessionAttachmentIndexStatus: 'ready',
            },
          ],
        },
      ],
    })
    await sourceRows.writeRows(original)
    source.blobs.set('image', 'data:image/png;base64,YWJj')
    source.blobs.set('parsed', '\uFEFFparsed🙂\n'.repeat(10_000))
    source.blobs.set('raw', 'data:application/pdf;base64,cGRm')
    source.blobs.set('result', 'Tool output🙂'.repeat(20_000))
    target.blobs.set('image', 'different original resource')
    let archive = new Blob()
    const exported = await exportBackupArchive({
      storage: source,
      metaStorage: new MemoryMetaStorage(),
      exportItems: ['conversations'],
      includeKeys: false,
      sharded: { store: sourceRows },
      application: { version: 'test', platform: 'test' },
      writeArchive: async (stream) => {
        const parts: Uint8Array<ArrayBuffer>[] = []
        for await (const part of stream()) parts.push(new Uint8Array(part))
        archive = new Blob(parts)
        return { boundedMemory: true }
      },
    })
    expect(exported.manifest.resources).toHaveLength(4)
    await importBackupArchive(archive, {
      storage: target,
      metaStorage: new MemoryMetaStorage(),
      sharded: { store: targetRows },
    })
    const restored = (await targetRows.readSnapshot(original.record.id))!.rows.messages[0].message
    expect(restored.contentParts[0]).toEqual({ type: 'text', text })
    const image = restored.contentParts[1]
    if (image.type !== 'image') throw new Error('Image reference missing')
    expect(target.blobs.get(image.storageKey)).toBe('data:image/png;base64,YWJj')
    expect(target.blobs.get('image')).toBe('different original resource')
    expect(restored.contentParts[2]).toMatchObject({
      args: { storageKey: 'image', value: text },
      resultStorageKey: 'result',
    })
    expect(restored.files?.[0]).toMatchObject({ storageKey: 'parsed', rawStorageKey: 'raw', ragMode: 'inline' })
    expect(restored.files?.[0]).not.toHaveProperty('localPath')
    expect(restored.files?.[0]).not.toHaveProperty('sessionAttachmentId')
    expect(restored.files?.[0]).not.toHaveProperty('sessionAttachmentIndexStatus')
    for (const key of ['raw', 'parsed', 'result']) expect(target.blobs.get(key)).toBe(source.blobs.get(key))
    const beforeRows = await targetRows.readSnapshot(original.record.id)
    const beforeBlobs = new Map(target.blobs)
    const abort = new AbortController()
    await expect(
      importBackupArchive(archive, {
        storage: target,
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: targetRows },
        signal: abort.signal,
        onProgress: (progress) => {
          if (progress.phase === 'restoring') abort.abort()
        },
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect((await targetRows.readSnapshot(original.record.id))?.rows).toEqual(beforeRows?.rows)
    expect(target.blobs).toEqual(beforeBlobs)
  } finally {
    sourceDb.close()
    targetDb.close()
  }
})

it('rejects a cumulative resource directory budget before reading resource bodies', async () => {
  const source = new StreamStorage()
  for (let index = 0; index < 40; index++) {
    const id = String(index)
    source.values.set(`session:${id}`, {
      id,
      name: id,
      messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'image', storageKey: id + 'k'.repeat(32700) }] }],
    })
  }
  await expect(
    exportBackupArchive({
      storage: source,
      metaStorage: new MemoryMetaStorage(),
      exportItems: ['conversations'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (stream) => {
        for await (const part of stream()) void part
        return { boundedMemory: true }
      },
    })
  ).rejects.toThrow('Backup resource references exceed budget')
})

it('records an interrupted resource source as missing and promptly cancels target fingerprinting', async () => {
  const source = new StreamStorage()
  source.values.set('session:s', {
    id: 's',
    name: 's',
    messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'image', storageKey: 'image' }] }],
  })
  source.blobs.set('image', 'data:image/png;base64,YWJj')
  let archive = new Blob()
  const options = {
    storage: source,
    metaStorage: new MemoryMetaStorage(),
    exportItems: ['conversations'] as ['conversations'],
    includeKeys: false,
    application: { version: 'test', platform: 'test' },
    writeArchive: async (stream: () => AsyncIterable<Uint8Array>) => {
      const parts: Uint8Array<ArrayBuffer>[] = []
      for await (const part of stream()) parts.push(new Uint8Array(part))
      archive = new Blob(parts)
      return { boundedMemory: true }
    },
  }
  await exportBackupArchive(options)
  const target = new StreamStorage()
  const controller = new AbortController()
  let readChunks = 0
  const read = target.blobStreams.read
  target.blobStreams.read = async (key) =>
    key !== 'image'
      ? read(key)
      : (async function* () {
          yield 'data:image/png;base64,'
          for (let index = 0; index < 1000; index++) {
            readChunks++
            controller.abort()
            yield 'YWJj'
          }
        })()
  await expect(
    importBackupArchive(archive, { storage: target, metaStorage: new MemoryMetaStorage(), signal: controller.signal })
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(readChunks).toBe(1)
  expect(target.blobs.size).toBe(0)
  expect(target.values.size).toBe(0)
  source.blobStreams.read = async () =>
    (async function* () {
      yield 'data:image/png;base64,YWJj'
      throw new Error('Read failed')
    })()
  const result = await exportBackupArchive(options)
  expect(result.manifest.resources).toHaveLength(0)
  expect(result.manifest.warnings).toContainEqual(
    expect.objectContaining({ code: 'resource-read-failed', itemId: 'image' })
  )
})
