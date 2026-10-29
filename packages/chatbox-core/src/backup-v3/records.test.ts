import { describe, expect, it, vi } from 'vitest'
import { RecordOrder } from './records'
import type { BackupBusinessRecord, BackupImportIssueReporter, BackupManifest, BackupWorkspace } from './types'

const manifest: BackupManifest = {
  format: 'chatbox-backup',
  formatVersion: 3,
  layout: 'rows',
  archiveId: 'record-order-test',
  createdAt: '2026-10-27T00:00:00Z',
  producer: 'test',
  selection: { sessions: true, settings: true, copilots: true, credentials: false },
}

function workspace(): BackupWorkspace {
  const tables = new Map<string, Set<string>>()
  return {
    createFile: vi.fn(async () => {
      throw new Error('Unexpected file write')
    }),
    openFile: vi.fn(async () => {
      throw new Error('Unexpected file read')
    }),
    put: vi.fn(async (table: string, key: string) => {
      const ids = tables.get(table) ?? new Set<string>()
      tables.set(table, ids)
      if (ids.has(key)) return false
      ids.add(key)
      return true
    }),
    get: vi.fn(async () => null),
    async *entries() {},
    dispose: vi.fn(async () => {}),
  }
}

function records(sessionId: string, threadId = 'thread', messageId = 'message') {
  const session: Extract<BackupBusinessRecord, { type: 'session' }> = {
    type: 'session',
    session: { id: sessionId, name: sessionId, activeThreadId: threadId },
  }
  const thread: Extract<BackupBusinessRecord, { type: 'thread' }> = {
    type: 'thread',
    thread: {
      sessionId,
      threadId,
      threadOrder: -1,
      name: null,
      rootMessageId: messageId,
      createdAt: 1,
      compactionPoints: [],
    },
  }
  const message: Extract<BackupBusinessRecord, { type: 'message' }> = {
    type: 'message',
    message: {
      sessionId,
      threadId,
      messageId,
      parentMessageId: null,
      activeChildId: null,
      siblingOrder: 0,
      kind: 'message',
      branchId: null,
      createdAt: 1,
      updatedAt: 1,
      message: { id: messageId, role: 'user', contentParts: [{ type: 'text', text: 'body' }] },
    },
  }
  return { session, thread, message }
}

describe('export record identities', () => {
  it('scopes thread and message identities to the current conversation and avoids workspace I/O', async () => {
    const store = workspace(),
      order = new RecordOrder(store, manifest)
    for (const sessionId of ['A', 'B']) {
      for (const record of Object.values(records(sessionId))) expect(await order.accept(record)).toBe(true)
    }
    await expect(order.accept(records('A').session)).rejects.toThrow('duplicate conversation')
    expect(store.put).not.toHaveBeenCalled()
    expect(store.get).not.toHaveBeenCalled()
    expect(store.createFile).not.toHaveBeenCalled()
    expect(store.openFile).not.toHaveBeenCalled()
  })

  it('requires a thread in the current conversation even when its ID appeared in a previous conversation', async () => {
    const order = new RecordOrder(workspace(), manifest)
    for (const record of Object.values(records('A'))) await order.accept(record)
    const next = records('B')
    await order.accept(next.session)
    await expect(order.accept(next.message)).rejects.toThrow('owning thread is missing')
  })

  it.each(['thread', 'message'] as const)('rejects a duplicate %s within a conversation', async (kind) => {
    const order = new RecordOrder(workspace(), manifest),
      input = records('A')
    await order.accept(input.session)
    await order.accept(input.thread)
    if (kind === 'message') await order.accept(input.message)
    await expect(order.accept(input[kind])).rejects.toThrow(`duplicate ${kind}`)
  })

  it('keeps global identities unique within each category', async () => {
    const store = workspace(),
      order = new RecordOrder(store, manifest)
    const global: Extract<BackupBusinessRecord, { type: 'global' }> = {
      type: 'global',
      category: 'settings',
      id: 'shared-id',
      value: {},
    }
    expect(await order.accept(global)).toBe(true)
    expect(await order.accept({ ...global, category: 'soul' })).toBe(true)
    await expect(order.accept(global)).rejects.toThrow('duplicate settings')
    expect(store.put).not.toHaveBeenCalled()
  })

  it('rejects rows owned by another conversation and mismatched message identities', async () => {
    const order = new RecordOrder(workspace(), manifest),
      input = records('A')
    await order.accept(input.session)
    await expect(order.accept(records('B').thread)).rejects.toThrow('owning conversation')
    await order.accept(input.thread)
    await expect(
      order.accept({
        ...input.message,
        message: { ...input.message.message, message: { ...input.message.message.message, id: 'different' } },
      })
    ).rejects.toThrow('row ID and content ID do not match')
  })
})

it('retains import header deduplication and delegates owned row validation to the candidate writer', async () => {
  const store = workspace(),
    reportIssue = vi.fn<BackupImportIssueReporter>(),
    order = new RecordOrder(store, manifest, reportIssue),
    input = records('A')
  const global: Extract<BackupBusinessRecord, { type: 'global' }> = {
    type: 'global',
    category: 'settings',
    id: 'settings',
    value: {},
  }
  expect(await order.accept(global)).toBe(true)
  expect(await order.accept(global)).toBe(false)
  expect(await order.accept(input.session)).toBe(true)
  expect(await order.accept(input.message)).toBe(true)
  expect(await order.accept(input.message)).toBe(true)
  expect(await order.accept(input.thread)).toBe(true)
  expect(await order.accept(input.thread)).toBe(true)
  expect(await order.accept(records('B').thread)).toBe(false)
  expect(await order.accept(input.session)).toBe(false)
  expect(reportIssue.mock.calls.map(([issue]) => issue.code)).toEqual([
    'duplicate-global',
    'missing-session',
    'duplicate-session',
  ])
  expect(vi.mocked(store.put).mock.calls.map(([table]) => table)).toEqual([
    'global-ids',
    'global-ids',
    'session-ids',
    'session-ids',
  ])
  expect(store.get).not.toHaveBeenCalled()
})
