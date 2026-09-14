import { expect, it } from 'vitest'
import { exportBackupArchive } from './export-backup'
import { importBackupArchive } from './import-backup'
import { legacyBackupSource } from './legacy-source'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import { openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import { openSqlBackupValue } from './sql-value-file'
import type { Session } from '@shared/types'

it.each(['range', 'materialized'] as const)(
  'restores %s legacy legacy messages, archived threads and unknown fields without whole-value reads',
  async (mode) => {
    const text = '旧数据🙂\\"\n'.repeat(40_000)
    const session: Session = {
      id: 'legacy',
      name: 'Old',
      messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'text', text }] }],
      threads: [
        {
          id: 'old',
          name: 'Old thread',
          createdAt: 1,
          messages: [{ id: 'old-message', role: 'assistant', contentParts: [{ type: 'text', text: 'archived' }] }],
        },
      ],
    }
    session.messageForksHash = {
      m: {
        position: 1,
        createdAt: 4,
        lists: [
          {
            id: 'alt',
            messages: [{ id: 'alternative', role: 'assistant', contentParts: [{ type: 'text', text: 'branch' }] }],
          },
          { id: 'selected', messages: [] },
        ],
      },
    }
    session.messages.push(
      Object.assign(
        { id: 'old-style', role: 'user' as const, contentParts: [] },
        {
          content: 'legacy正文🙂'.repeat(10000),
          webBrowsing: {
            query: ['q'.repeat(6000)],
            links: [{ title: 'title'.repeat(1200), url: 'https://example.com' }],
          },
          pictures: [{ storageKey: 'old-image', url: 'data:image/png;base64,' + 'YWFh'.repeat(1500) }],
        }
      )
    )
    Object.defineProperty(session.messages[1], 'contentParts', {
      value: undefined,
      enumerable: true,
      configurable: true,
    })
    Object.assign(session.messages[0], { futureData: { preserved: text } })
    const raw = new TextEncoder().encode(JSON.stringify(session))
    let largestRead = 0
    const database = openNodeSessionRowDatabase()
    try {
      const target = new SqlSessionRowStore(database)
      await database.executeBatch([
        { sql: 'CREATE TABLE key_value (key TEXT PRIMARY KEY, value TEXT)', params: [] },
        { sql: 'INSERT INTO key_value VALUES (?, ?)', params: ['session:legacy', new TextDecoder().decode(raw)] },
      ])
      const store = legacyBackupSource(target, {
        listSessionIds: async () => ['legacy'],
        readValue: async () => session,
        open:
          mode === 'materialized'
            ? undefined
            : async () => {
                const file = await openSqlBackupValue(database, 'session:legacy')
                if (!file) throw new Error('Missing source')
                return {
                  ...file,
                  readBytes: async (offset, length) => {
                    largestRead = Math.max(largestRead, length)
                    return file.readBytes!(offset, length)
                  },
                }
              },
      })
      let archive = new Blob()
      await exportBackupArchive({
        storage: new MemoryStorage(),
        metaStorage: new MemoryMetaStorage(),
        exportItems: ['conversations'],
        includeKeys: false,
        application: { version: 'test', platform: 'test' },
        sharded: { store },
        writeArchive: async (stream) => {
          const parts: Uint8Array<ArrayBuffer>[] = []
          for await (const part of stream()) parts.push(new Uint8Array(part))
          archive = new Blob(parts)
          return { boundedMemory: true }
        },
      })
      await importBackupArchive(archive, {
        storage: new MemoryStorage(),
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: target },
      })
      const restored = await target.readSnapshot('legacy')
      expect(restored?.rows.messages.find((row) => row.messageId === 'm')?.message).toEqual(session.messages[0])
      expect(restored?.rows.messages.find((row) => row.messageId === 'old-message')?.message.contentParts).toEqual([
        { type: 'text', text: 'archived' },
      ])
      expect(restored?.rows.messages.find((row) => row.messageId === 'alternative')?.message.contentParts).toEqual([
        { type: 'text', text: 'branch' },
      ])
      expect(restored?.rows.messages.find((row) => row.messageId === 'old-style')?.message).toMatchObject({
        content: 'legacy正文🙂'.repeat(10000),
        contentParts: expect.arrayContaining([
          { type: 'text', text: 'legacy正文🙂'.repeat(10000) },
          expect.objectContaining({
            type: 'tool-call',
            args: { query: 'q'.repeat(6000) },
            result: {
              query: 'q'.repeat(6000),
              searchResults: [
                { title: 'title'.repeat(1200), link: 'https://example.com', snippet: 'title'.repeat(1200) },
              ],
            },
          }),
          expect.objectContaining({ type: 'image', url: 'data:image/png;base64,' + 'YWFh'.repeat(1500) }),
        ]),
      })
      expect(largestRead).toBeLessThanOrEqual(64 * 1024)
      expect(raw.length).toBeGreaterThan(128 * 1024)
    } finally {
      database.close()
    }
  }
)

it('rejects truncated legacy JSON and never publishes a partial session', async () => {
  const database = openNodeSessionRowDatabase()
  try {
    const rows = new SqlSessionRowStore(database)
    const source = legacyBackupSource(rows, {
      listSessionIds: async () => ['s'],
      open: async () => new Blob(['{"id":"s","name":"s","messages":[{"id":"m"']),
    })
    await expect(
      exportBackupArchive({
        storage: new MemoryStorage(),
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: source },
        exportItems: ['conversations'],
        includeKeys: false,
        application: { version: 'test', platform: 'test' },
        writeArchive: async (stream) => {
          for await (const part of stream()) void part
          return { boundedMemory: true }
        },
      })
    ).rejects.toThrow(/incomplete/i)
    expect(await rows.listSessionIds()).toEqual([])
  } finally {
    database.close()
  }
})

it.runIf(process.env.RUN_LARGE_BACKUP === '1')(
  'round trips a 129 MiB historical SQL session through bounded reads',
  async () => {
    const database = openNodeSessionRowDatabase()
    try {
      await database.executeBatch([{ sql: 'CREATE TABLE key_value (key TEXT PRIMARY KEY, value TEXT)', params: [] }])
      const body = 'x'.repeat(129 * 1024 * 1024)
      await database.executeBatch([
        {
          sql: 'INSERT INTO key_value VALUES (?, ?)',
          params: [
            'session:huge',
            `{"id":"huge","name":"Huge legacy","messages":[{"id":"m","role":"user","contentParts":[{"type":"text","text":"${body}"}]}]}`,
          ],
        },
      ])
      const target = new SqlSessionRowStore(database)
      const store = legacyBackupSource(target, {
        listSessionIds: async () => ['huge'],
        open: (id) => openSqlBackupValue(database, `session:${id}`),
      })
      let archive = new Blob()
      await exportBackupArchive({
        storage: new MemoryStorage(),
        metaStorage: new MemoryMetaStorage(),
        sharded: { store },
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
      await importBackupArchive(archive, {
        storage: new MemoryStorage(),
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: target },
      })
      expect((await target.readSnapshot('huge'))?.rows.messages[0].message.contentParts).toEqual([
        { type: 'text', text: body },
      ])
    } finally {
      database.close()
    }
  },
  180_000
)

it('reads byte ranges across released SQL chunk boundaries including Unicode and NUL', async () => {
  const database = openNodeSessionRowDatabase()
  try {
    await database.executeBatch([
      { sql: 'CREATE TABLE key_value (key TEXT PRIMARY KEY, value TEXT)', params: [] },
      { sql: 'CREATE TABLE key_value_chunks (key TEXT, generation TEXT, chunk_index INTEGER, value TEXT)', params: [] },
      { sql: 'INSERT INTO key_value VALUES (?, ?)', params: ['k', '__CHATBOX_CHUNKED_VALUE_V1__:g:2:7'] },
      { sql: 'INSERT INTO key_value_chunks VALUES (?, ?, ?, ?)', params: ['k', 'g', 0, 'ab🙂'] },
      { sql: 'INSERT INTO key_value_chunks VALUES (?, ?, ?, ?)', params: ['k', 'g', 1, '中\0z'] },
    ])
    const file = await openSqlBackupValue(database, 'k')
    const expected = new TextEncoder().encode('ab🙂中\0z')
    expect(file?.size).toBe(expected.length)
    expect(await file?.readBytes?.(3, 6)).toEqual(expected.slice(3, 9))
    expect(await file?.readBytes?.(0, expected.length)).toEqual(expected)
    await database.executeBatch([
      { sql: 'UPDATE key_value SET value = ?', params: ['__CHATBOX_CHUNKED_VALUE_V1__:g:2:8'] },
    ])
    const damaged = await openSqlBackupValue(database, 'k')
    await expect(damaged?.readBytes?.(0, expected.length)).rejects.toThrow('character count mismatch')
  } finally {
    database.close()
  }
})
