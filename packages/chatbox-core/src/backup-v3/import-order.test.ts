import { afterEach, describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import { createBackupImportTarget } from '../backup-host/host'
import type { BackupHostOptions } from '../backup-host/types'
import { mergeSettingsWithDefaults } from '../domain/settings'
import { InMemorySessionRecordStore } from '../persistence/memory-session-record-store'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import { InMemoryKeyValueStorage } from '../testing/InMemoryKeyValueStorage'
import { InMemorySessionRepository } from '../testing/InMemorySessionRepository'
import { importBackupV3 } from './archive'
import { getBackupImportPartialResult } from './errors'
import { RecordOrder, toBackupMessage, toBackupSession, toBackupThread } from './records'
import type { BackupBusinessRecord, BackupManifest, BackupWorkspace } from './types'

const encoder = new TextEncoder()
const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
const manifest: BackupManifest = {
  format: 'chatbox-backup',
  formatVersion: 3,
  layout: 'rows',
  archiveId: 'order-test',
  createdAt: '2026-10-22T00:00:00Z',
  producer: 'test',
  selection: { sessions: true, settings: false, copilots: false, credentials: false },
}
function fixture(id = 'A', count = 2) {
  return contextSnapshot({
    id,
    name: id,
    messages: Array.from({ length: count }, (_, index) => ({
      id: `${id}-${index}`,
      role: 'user' as const,
      contentParts: [{ type: 'text' as const, text: `body-${index}` }],
    })),
  })
}
function records(snapshot: ReturnType<typeof fixture>): BackupBusinessRecord[] {
  return [
    { type: 'session', session: toBackupSession(snapshot.record) },
    ...snapshot.rows.threads.map((thread) => ({ type: 'thread' as const, thread: toBackupThread(thread) })),
    ...snapshot.rows.messages.map((message) => ({ type: 'message' as const, message: toBackupMessage(message) })),
  ]
}
function archive(groups: Record<string, BackupBusinessRecord[] | string>) {
  const entries: Record<string, Uint8Array> = {
    'manifest.json': encoder.encode(JSON.stringify(manifest)),
    'resources.jsonl': new Uint8Array(),
  }
  for (const [id, rows] of Object.entries(groups))
    entries[`sessions/${id}.jsonl`] = encoder.encode(
      typeof rows === 'string' ? rows : rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
    )
  entries['complete.json'] = encoder.encode(JSON.stringify({ archiveId: manifest.archiveId }))
  const bytes = zipSync(entries)
  return {
    size: bytes.length,
    readBytes: async (offset: number, length: number) => bytes.slice(offset, offset + length),
  }
}
function setup() {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const rows = new SqlSessionRowStore(database)
  const tables = new Map<string, Map<string, string>>()
  const workspace: BackupWorkspace = {
    async createFile() {
      throw new Error('Unexpected temporary file')
    },
    async openFile() {
      throw new Error('Unexpected temporary file')
    },
    put: vi.fn(async (table: string, key: string, value: string) => {
      const entries = tables.get(table) ?? new Map<string, string>()
      tables.set(table, entries)
      if (entries.has(key)) return false
      entries.set(key, value)
      return true
    }),
    get: vi.fn(async (table: string, key: string) => tables.get(table)?.get(key) ?? null),
    async *entries(table) {
      for (const [key, value] of tables.get(table) ?? []) yield { key, value }
    },
    async dispose() {
      tables.clear()
    },
  }
  const options: BackupHostOptions = {
    jobId: 'import-order-job',
    workspace,
    storage: new InMemoryKeyValueStorage(),
    records: new InMemorySessionRecordStore(),
    rows,
    metadata: new InMemorySessionRepository().meta,
    resources: {
      async open() {
        return null
      },
      async stage() {
        throw new Error('No resource entries in fixture')
      },
      publish: vi.fn(),
      cleanup: vi.fn(),
    },
    async ensureRows() {},
    async *listSessionIds() {},
    getSettings: () => mergeSettingsWithDefaults({}),
    async refresh() {},
  }
  const target = createBackupImportTarget(options)
  const append = vi.spyOn(target, 'appendRecords')
  return {
    rows,
    options,
    workspace,
    target,
    append,
    run: (groups: Record<string, BackupBusinessRecord[] | string>) =>
      importBackupV3({ source: archive(groups), workspace, target }),
  }
}

describe('V3 candidate batch validation', () => {
  it.each([2, 130])(
    'keeps the first message when its duplicate is within or beyond a batch (%i rows)',
    async (count) => {
      const f = setup()
      const input = records(fixture('A', count))
      const first = input.find((row) => row.type === 'message')
      if (first?.type !== 'message') throw new Error('fixture')
      input.push({
        type: 'message',
        message: {
          ...first.message,
          message: { ...first.message.message, contentParts: [{ type: 'text', text: 'later' }] },
        },
      })
      const result = await f.run({ A: input })
      expect(result.importReport).toMatchObject({
        importedSessions: 1,
        importedMessages: count,
        skippedRecords: 1,
        issueCount: 1,
      })
      expect(result.importReport?.issues[0].code).toBe('duplicate-row')
      const stored = await f.rows.readMessages({ sessionId: 'A', messageIds: ['A-0'] })
      expect(stored?.messages[0].message.contentParts).toEqual([{ type: 'text', text: 'body-0' }])
      const rowBatches = f.append.mock.calls.filter(([batch]) => batch.some((row) => row.type === 'message'))
      expect(rowBatches.length > 1).toBe(count > 128)
      for (const operation of [f.workspace.get, f.workspace.put])
        expect(
          vi.mocked(operation).mock.calls.some(([table]) => table === 'thread-ids' || table === 'message-ids')
        ).toBe(false)
    }
  )

  it.each([2, 130])('allows a valid message after an invalid occurrence of its ID (%i rows)', async (count) => {
    const f = setup()
    const input = records(fixture('A', count))
    const first = input.find((row) => row.type === 'message')
    if (first?.type !== 'message') throw new Error('fixture')
    const index = input.indexOf(first)
    input[index] = {
      type: 'message',
      message: { ...first.message, message: { ...first.message.message, id: 'wrong-id' } },
    }
    input.push(first)
    const result = await f.run({ A: input })
    expect(result.importReport).toMatchObject({ importedMessages: count, skippedRecords: 1, issueCount: 1 })
    expect(result.importReport?.issues[0].code).toBe('invalid-row')
    expect((await f.rows.readMessages({ sessionId: 'A', messageIds: ['A-0'] }))?.messages[0].message.id).toBe('A-0')
  })

  it('keeps the first thread when a duplicate appears after its messages', async () => {
    const f = setup()
    const input = records(fixture('A', 1))
    const thread = input[1]
    if (thread.type !== 'thread') throw new Error('fixture')
    input.push({ type: 'thread', thread: { ...thread.thread, name: 'replacement', threadOrder: 0 } })
    const result = await f.run({ A: input })
    expect(result.importReport).toMatchObject({ importedMessages: 1, skippedRecords: 1, issueCount: 1 })
    expect(result.importReport?.issues[0].code).toBe('duplicate-row')
    const stored = []
    for await (const row of f.rows.iterateRows({ sessionId: 'A' })) if (row.kind === 'thread') stored.push(row.thread)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ name: thread.thread.name, threadOrder: thread.thread.threadOrder })
  })

  it('reports a missing thread once and preserves a local conversation when all input messages are unusable', async () => {
    const f = setup()
    const original = fixture('A', 1)
    original.record.name = 'local'
    await f.rows.writeRows(original)
    await f.options.records.setRecord(original.record)
    const broken = records(fixture('A', 1)).filter((row) => row.type !== 'thread')
    const result = await f.run({ A: broken, B: records(fixture('B', 1)) })
    expect(result.importReport).toMatchObject({ importedSessions: 1, importedMessages: 1, skippedRecords: 2 })
    expect(result.importReport?.issues.filter((issue) => issue.code === 'missing-thread')).toHaveLength(1)
    expect(result.importReport?.issues.filter((issue) => issue.code === 'unusable-session')).toHaveLength(1)
    expect((await f.rows.readCommit('A'))?.record.name).toBe('local')
    expect(
      (await f.rows.readMessages({ sessionId: 'A', messageIds: ['A-0'] }))?.messages[0].message.contentParts
    ).toEqual([{ type: 'text', text: 'body-0' }])
  })

  it('reports input attachment references from a skipped duplicate without replacing the accepted message', async () => {
    const f = setup()
    const input = records(fixture('A', 1))
    const first = input.find((row) => row.type === 'message')
    if (first?.type !== 'message') throw new Error('fixture')
    input.push({
      type: 'message',
      message: {
        ...first.message,
        message: { ...first.message.message, contentParts: [{ type: 'image', storageKey: 'missing-input-resource' }] },
      },
    })
    const result = await f.run({ A: input })
    expect(result.importReport).toMatchObject({
      importedMessages: 1,
      importedResources: 0,
      skippedRecords: 1,
      issueCount: 2,
    })
    expect(result.importReport?.issues.map((issue) => issue.code)).toEqual(['duplicate-row', 'missing-resource'])
    expect(result.importReport?.issues[1].message).toBe('An attachment referenced by the backup is missing.')
    expect(
      (await f.rows.readMessages({ sessionId: 'A', messageIds: ['A-0'] }))?.messages[0].message.contentParts
    ).toEqual([{ type: 'text', text: 'body-0' }])
    expect(f.options.resources.publish).not.toHaveBeenCalled()
  })

  it('keeps file ownership and publication atomic when orphan rows or duplicate headers appear', async () => {
    const f = setup()
    const original = fixture('A', 1)
    original.record.name = 'local'
    await f.rows.writeRows(original)
    await f.options.records.setRecord(original.record)
    const a = records(fixture('A', 1))
    const text = [...a, a[0]].map((row) => JSON.stringify(row)).join('\n') + '\n{malformed\n'
    let failure: unknown
    try {
      await f.run({ B: records(fixture('B', 1)), C: records(fixture('C', 1)).slice(1), A: text })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeDefined()
    const report = getBackupImportPartialResult(failure)?.importReport
    expect(report).toMatchObject({ importedSessions: 1, importedMessages: 1, skippedRecords: 3 })
    expect(report?.issues.map((issue) => issue.code)).toEqual(['missing-session', 'missing-session', 'record-order'])
    expect((await f.rows.readCommit('A'))?.record.name).toBe('local')
    expect(await f.rows.readCommit('B')).not.toBeNull()
    expect(await f.rows.readCommit('C')).toBeNull()
  })

  it.each(['duplicate-thread', 'duplicate-message', 'missing-thread', 'message-identity', 'thread-after-message'])(
    'keeps export strict for %s',
    async (kind) => {
      const f = setup()
      const order = new RecordOrder(f.workspace, manifest)
      const input = records(fixture('A', 1))
      const session = input[0],
        thread = input[1],
        message = input[2]
      if (message.type !== 'message') throw new Error('fixture')
      await order.accept(session)
      if (kind !== 'missing-thread') await order.accept(thread)
      if (kind === 'duplicate-message' || kind === 'thread-after-message') await order.accept(message)
      const invalid =
        kind === 'duplicate-thread' || kind === 'thread-after-message'
          ? thread
          : kind === 'message-identity'
            ? { ...message, message: { ...message.message, message: { ...message.message.message, id: 'wrong-id' } } }
            : message
      await expect(order.accept(invalid)).rejects.toThrow()
    }
  )
})

it('restores edges and endpoints when V3 message IDs arrive independently of tree order across batches', async () => {
  const f = setup(),
    source = fixture('A', 257),
    input = records(source)
  const messages = input.filter((row) => row.type === 'message').reverse()
  const result = await f.run({ A: [...input.filter((row) => row.type !== 'message'), ...messages] })
  expect(result.importReport).toMatchObject({ importedSessions: 1, importedMessages: 257, issueCount: 0 })
  const thread = await f.rows.readThreadState({
    sessionId: 'A',
    threadId: source.rows.threads[0].threadId,
    expectedRevision: (await f.rows.readCommit('A'))!.revision,
  })
  expect(thread?.status === 'ready' && thread.thread).toMatchObject({
    rootMessageId: 'A-0',
    activeLeafMessageId: 'A-256',
    summary: { messageCount: 257 },
  })
  const page = await f.rows.readTranscriptWindow({ sessionId: 'A', origin: 'tail', limit: 50 })
  expect(page?.messages.map((row) => row.messageId)).toEqual(
    Array.from({ length: 50 }, (_, index) => `A-${207 + index}`)
  )
})
