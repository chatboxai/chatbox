import 'fake-indexeddb/auto'
import type { SessionRowCommit, SessionRowSnapshot, SessionRows } from '@chatbox/core/ports'
import { createSessionRowStoreContract } from '@chatbox/core/ports/testing/session-row-store-contract'
import type { MessageRow, ThreadRow } from '@chatbox/core/session/session-tree'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexedDBSessionRowStore } from '../SessionRowStorage'

function threadRow(sessionId: string, threadId: string, overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    sessionId,
    threadId,
    seq: -1,
    name: threadId,
    createdAt: 1_000,
    rootMessageId: null,
    activeLeafMessageId: null,
    compactionPoints: [],
    ...overrides,
  }
}

function messageRow(
  sessionId: string,
  threadId: string,
  messageId: string,
  overrides: Partial<MessageRow> = {}
): MessageRow {
  return {
    sessionId,
    threadId,
    messageId,
    parentMessageId: null,
    activeChildId: null,
    seq: 0,
    kind: 'message',
    status: 'settled',
    createdAt: 1_000,
    updatedAt: 1_000,
    branchId: null,
    message: { id: messageId, role: 'user', contentParts: [] },
    ...overrides,
  }
}

function commit(sessionId: string, revision: number, activeThreadId: string): SessionRowCommit {
  return {
    revision,
    record: { id: sessionId, type: 'chat', name: sessionId, activeThreadId, storageFormat: 'rows' },
  }
}

function snapshot(rows: SessionRows, revision: number): SessionRowSnapshot {
  const activeThreadId = rows.threads.find((thread) => thread.seq === -1)?.threadId ?? rows.threads[0]?.threadId
  if (!activeThreadId) throw new Error(`no active thread for ${rows.sessionId}`)
  return { rows, ...commit(rows.sessionId, revision, activeThreadId) }
}

/** A row carrying a function, which structured clone rejects inside `put`. */
function unclonableRow(row: MessageRow): MessageRow {
  const broken: Record<string, unknown> = { ...row, revive: () => undefined }
  return broken as unknown as MessageRow
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('IndexedDBSessionRowStore shared behavior contract', () => {
  for (const contractCase of createSessionRowStoreContract(() => new IndexedDBSessionRowStore())) {
    it(contractCase.name, contractCase.run)
  }
})

describe('IndexedDBSessionRowStore', () => {
  it('keeps the stored rows when a full write fails inside the transaction', async () => {
    const store = new IndexedDBSessionRowStore()
    await store.initialize()
    const stored = {
      sessionId: 'session-1',
      threads: [threadRow('session-1', 'thread-active')],
      messages: [messageRow('session-1', 'thread-active', 'm1')],
    }
    await store.writeRows(snapshot(stored, 1))

    await expect(
      store.writeRows(
        snapshot(
          {
            sessionId: 'session-1',
            threads: [threadRow('session-1', 'thread-next', { seq: 0 })],
            messages: [
              messageRow('session-1', 'thread-next', 'm2'),
              unclonableRow(messageRow('session-1', 'thread-next', 'm3', { seq: 1 })),
            ],
          },
          2
        ),
        1
      )
    ).rejects.toMatchObject({ name: 'SessionRowStoreError', operation: 'write-rows', sessionId: 'session-1' })

    await expect(store.readSnapshot('session-1')).resolves.toMatchObject({ rows: stored, revision: 1 })
  })

  it('returns only matching references ordered by session, thread and message id', async () => {
    const store = new IndexedDBSessionRowStore()
    await store.initialize()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-2',
          threads: [threadRow('session-2', 'thread-b')],
          messages: [
            messageRow('session-2', 'thread-b', 'm4', { status: 'generating' }),
            messageRow('session-2', 'thread-b', 'm1', { seq: 1 }),
          ],
        },
        1
      )
    )
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('session-1', 'thread-a'), threadRow('session-1', 'thread-b', { seq: 0 })],
          messages: [
            messageRow('session-1', 'thread-b', 'm3', { status: 'generating' }),
            messageRow('session-1', 'thread-a', 'm2', { seq: 1, status: 'generating' }),
            messageRow('session-1', 'thread-a', 'm1', { seq: 2 }),
          ],
        },
        1
      )
    )

    await expect(store.findMessagesByStatus('generating')).resolves.toEqual([
      { sessionId: 'session-1', threadId: 'thread-a', messageId: 'm2' },
      { sessionId: 'session-1', threadId: 'thread-b', messageId: 'm3' },
      { sessionId: 'session-2', threadId: 'thread-b', messageId: 'm4' },
    ])
  })

  it('lists sessions that hold thread rows without message rows', async () => {
    const store = new IndexedDBSessionRowStore()
    await store.initialize()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-threads-only',
          threads: [threadRow('session-threads-only', 'thread-active')],
          messages: [],
        },
        1
      )
    )

    await expect(store.listSessionIds()).resolves.toEqual(['session-threads-only'])
    await expect(store.hasRows('session-threads-only')).resolves.toBe(true)
  })

  it('reads and guards revisions through the fixed head key without cloning thread payloads', async () => {
    const store = new IndexedDBSessionRowStore()
    await store.initialize()
    const thread = threadRow('session-1', 'thread-active', {
      sessionPromptContextSnapshot: {
        version: 1,
        soul: 's'.repeat(128 * 1024),
        memories: [],
        workspaceInstructions: 'w'.repeat(128 * 1024),
        workspaceDirectories: [],
        capturedAt: 1_000,
      },
    })
    await store.writeRows(snapshot({ sessionId: 'session-1', threads: [thread], messages: [] }, 1), null)
    const getAll = vi.spyOn(IDBIndex.prototype, 'getAll')

    await expect(store.getRevision('session-1')).resolves.toBe(1)
    await store.applyDiff(
      {
        sessionId: 'session-1',
        threads: { upsert: [{ ...thread, name: 'Renamed' }], delete: [] },
        messages: { upsert: [], delete: [] },
      },
      commit('session-1', 2, 'thread-active'),
      1
    )

    expect(getAll).not.toHaveBeenCalled()
    await expect(store.getRevision('session-1')).resolves.toBe(2)
  })
})
