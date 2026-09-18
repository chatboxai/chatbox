import { expect, it } from 'vitest'
import { openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import { decodeSessionTree } from '../session/session-tree/decode'
import { exportBackupArchive } from './export-backup'
import { jsonUtf8Blocks } from './json-stream'
import { prepareBackupExport } from './preflight'
import { prepareSessionForBackup } from './resources'
import type { BackupSessionStore } from './session-port'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'

const options = (sessionStore: BackupSessionStore) => ({
  sessionStore,
  storage: new MemoryStorage(),
  metaStorage: new MemoryMetaStorage(),
  exportItems: ['conversations'] as ['conversations'],
  includeKeys: false,
  application: { version: 'test', platform: 'test' },
})

it('stops classification at a proven lower bound and checks the unread tail only while writing', async () => {
  const db = openNodeSessionRowDatabase()
  try {
    const rows = new SqlSessionRowStore(db)
    await rows.writeRows(
      contextSnapshot({
        id: 's',
        name: 'S',
        messages: Array.from({ length: 4 }, (_, i) => ({
          id: `m${i}`,
          role: 'user' as const,
          contentParts: [{ type: 'text' as const, text: 'x'.repeat(64 * 1024) }],
        })),
      })
    )
    let readMessages = 0
    let closed = 0
    let writing = false
    const store: BackupSessionStore = {
      listSessionIds: () => rows.listSessionIds(),
      beginBackupRestore: (id) => rows.beginBackupRestore(id),
      async *iterateBackupRows(...args) {
        try {
          for await (const row of rows.iterateBackupRows(...args)) {
            if (row.kind === 'message' && ++readMessages === 3) {
              expect(writing).toBe(true)
              throw new Error('Unread tail is corrupt')
            }
            yield row
          }
        } finally {
          closed++
        }
      },
    }
    const settings = options(store)
    const plan = await prepareBackupExport(settings, { singleSessionBytes: 100 * 1024 })
    expect(plan.sessions).toEqual([{ id: 's', name: 'S', layout: 'sharded' }])
    expect(readMessages).toBe(2)
    expect(closed).toBe(1)
    readMessages = 0
    await expect(
      exportBackupArchive({
        ...settings,
        prepared: plan,
        writeArchive: async (stream) => {
          writing = true
          for await (const part of stream()) void part
          return { boundedMemory: true }
        },
      })
    ).rejects.toThrow('Unread tail is corrupt')
  } finally {
    db.close()
  }
})

it('closes a large message payload as soon as its prepared prefix exceeds the threshold', async () => {
  const snapshot = contextSnapshot({
    id: 's',
    name: 'S',
    messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'text', text: '' }] }],
  })
  let readBlocks = 0
  let closed = false
  const store: BackupSessionStore = {
    listSessionIds: async () => ['s'],
    beginBackupRestore: async () => {
      throw new Error('No writes during classification')
    },
    async *iterateBackupRows() {
      yield { kind: 'header', record: snapshot.record }
      for (const thread of snapshot.rows.threads) yield { kind: 'thread', thread }
      yield {
        kind: 'message',
        message: snapshot.rows.messages[0],
        payload: {
          chunks: async function* () {
            try {
              for (const block of jsonUtf8Blocks({
                id: 'm',
                role: 'user',
                contentParts: [{ type: 'text', text: '中🙂'.repeat(100_000) }],
              })) {
                readBlocks++
                yield block
              }
            } finally {
              closed = true
            }
          },
        },
      }
    },
  }
  const plan = await prepareBackupExport(options(store), { singleSessionBytes: 32 * 1024 })
  expect(plan.sessions[0].layout).toBe('sharded')
  expect(readBlocks).toBeLessThanOrEqual(2)
  expect(closed).toBe(true)
})

it('measures canonical v2 bytes across branches, Unicode, and cleaned attachment metadata without reading resources', async () => {
  const db = openNodeSessionRowDatabase()
  try {
    const rows = new SqlSessionRowStore(db)
    const source = contextSnapshot({
      id: 's',
      name: 'S',
      messages: [
        {
          id: 'm',
          role: 'user',
          contentParts: [{ type: 'text', text: '中🙂\\\"\n\ud800'.repeat(1000) }],
          files: [
            {
              id: 'f',
              name: 'paper.txt',
              fileType: 'text/plain',
              storageKey: 'missing-resource',
              localPath: '/private/'.repeat(3000),
              sessionAttachmentId: 4,
            },
          ],
        },
      ],
      threads: [
        {
          id: 't',
          name: 'Archive',
          createdAt: 1,
          messages: [{ id: 'old', role: 'assistant', contentParts: [{ type: 'text', text: 'old' }] }],
        },
      ],
      messageForksHash: {
        m: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'active', messages: [] },
            {
              id: 'alternative',
              messages: [{ id: 'alt', role: 'assistant', contentParts: [{ type: 'text', text: 'branch' }] }],
            },
          ],
        },
      },
    })
    await rows.writeRows(source)
    const decoded = decodeSessionTree({ session: source.record, ...source.rows })
    if (!decoded.ok) throw new Error(decoded.reason)
    const expected = new TextEncoder().encode(JSON.stringify(prepareSessionForBackup(decoded.session))).length
    class UnreadableGlobals extends MemoryStorage {
      override async getAllKeys(): Promise<string[]> {
        throw new Error('Global data must not be read during classification')
      }
      override async getBlob(): Promise<string | null> {
        throw new Error('Resources must not be read during classification')
      }
    }
    const settings = {
      ...options(rows),
      storage: new UnreadableGlobals(),
      exportItems: ['conversations', 'setting', 'copilot'] as ['conversations', 'setting', 'copilot'],
    }
    const plan = await prepareBackupExport(settings, { singleSessionBytes: expected })
    expect(plan.sessions[0]).toEqual({ id: 's', name: 'S', size: expected, layout: 'single' })
    expect(plan.warnings).toEqual([])
    expect((await prepareBackupExport(settings, { singleSessionBytes: expected - 1 })).sessions[0].layout).toBe(
      'sharded'
    )
    expect(await rows.readSnapshot('s')).toMatchObject({ rows: source.rows })
  } finally {
    db.close()
  }
})

const payloadSession = (count: number) =>
  contextSnapshot({
    id: 's',
    name: 'S',
    messages: Array.from({ length: count }, (_, i) => ({
      id: `m${i}`,
      role: 'user' as const,
      contentParts: [{ type: 'text' as const, text: `${i}:`.padEnd(200 * 1024, 'y') }],
    })),
  })

const countingStore = (rows: SqlSessionRowStore) => {
  let payloadReads = 0
  const store: BackupSessionStore = {
    listSessionIds: () => rows.listSessionIds(),
    beginBackupRestore: (id) => rows.beginBackupRestore(id),
    async *iterateBackupRows(...args) {
      for await (const row of rows.iterateBackupRows(...args)) {
        if (row.kind === 'message' && row.payload?.chunks) {
          const chunks = row.payload.chunks
          yield {
            ...row,
            payload: {
              ...row.payload,
              chunks: () => {
                payloadReads++
                return chunks()
              },
            },
          }
        } else yield row
      }
    },
  }
  return { store, payloadReads: () => payloadReads }
}

it('settles on the sharded layout from stored payload sizes without reading any payload', async () => {
  const db = openNodeSessionRowDatabase()
  try {
    const rows = new SqlSessionRowStore(db)
    await rows.writeRows(payloadSession(3))
    const { store, payloadReads } = countingStore(rows)
    const plan = await prepareBackupExport(options(store), { singleSessionBytes: 300 * 1024 })
    expect(plan.sessions).toEqual([{ id: 's', name: 'S', layout: 'sharded' }])
    expect(payloadReads()).toBe(0)
  } finally {
    db.close()
  }
})

it('measures deferred payloads exactly when the stored sizes fit the single-file budget', async () => {
  const db = openNodeSessionRowDatabase()
  try {
    const rows = new SqlSessionRowStore(db)
    const source = payloadSession(3)
    await rows.writeRows(source)
    const decoded = decodeSessionTree({ session: source.record, ...source.rows })
    if (!decoded.ok) throw new Error(decoded.reason)
    const expected = new TextEncoder().encode(JSON.stringify(prepareSessionForBackup(decoded.session))).length
    const { store, payloadReads } = countingStore(rows)
    const plan = await prepareBackupExport(options(store), { singleSessionBytes: 2 * 1024 * 1024 })
    expect(plan.sessions).toEqual([{ id: 's', name: 'S', layout: 'single', size: expected }])
    expect(payloadReads()).toBe(3)
  } finally {
    db.close()
  }
})
