import { afterEach, describe, expect, it } from 'vitest'
import type { SessionRowCommit, SessionRowSnapshot, SessionRows } from '../ports/session-row-store'
import { createSessionRowStoreContract } from '../ports/testing/session-row-store-contract'
import type { MessageRow, SessionRecordV2, ThreadRow } from '../session/session-tree/types'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import {
  type SessionRowSqlBindValue,
  type SessionRowSqlDatabase,
  type SessionRowSqlStatement,
  SqlSessionRowStore,
} from './session-row-sql'

const openDatabases: NodeSessionRowSqlDatabase[] = []

function createStore(): { database: NodeSessionRowSqlDatabase; store: SqlSessionRowStore } {
  const database = openNodeSessionRowDatabase()
  openDatabases.push(database)
  return { database, store: new SqlSessionRowStore(database) }
}

function threadRow(threadId: string, overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    sessionId: 'session-1',
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

function messageRow(threadId: string, messageId: string, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    sessionId: 'session-1',
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

function commit(revision: number, record?: SessionRecordV2): SessionRowCommit {
  return {
    revision,
    record: record ?? {
      id: 'session-1',
      type: 'chat',
      name: 'session-1',
      activeThreadId: 'thread-active',
      storageFormat: 'rows',
    },
  }
}

function snapshot(rows: SessionRows, revision: number, record?: SessionRecordV2): SessionRowSnapshot {
  const activeThreadId = rows.threads.find((thread) => thread.seq === -1)?.threadId
  const nextRecord = record ?? { ...commit(revision).record, activeThreadId: activeThreadId ?? 'thread-active' }
  return { rows, ...commit(revision, nextRecord) }
}

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close()
})

describe('SqlSessionRowStore shared contract on real SQLite', () => {
  for (const contractCase of createSessionRowStoreContract(() => createStore().store)) {
    it(contractCase.name, contractCase.run)
  }
})

describe('SqlSessionRowStore SQL shape', () => {
  it('scans message references by status without selecting the payload column', async () => {
    const { database, store } = createStore()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [
            messageRow('thread-active', 'm1'),
            messageRow('thread-active', 'm2', { seq: 1, status: 'generating' }),
          ],
        },
        1
      )
    )
    database.reset()

    await expect(store.findMessagesByStatus('generating')).resolves.toEqual([
      { sessionId: 'session-1', threadId: 'thread-active', messageId: 'm2' },
    ])
    expect(database.executed).toHaveLength(1)
    expect(database.executed[0]).not.toContain('message_json')
  })

  it('applies a diff in a single batch', async () => {
    const { database, store } = createStore()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [messageRow('thread-active', 'm1')],
        },
        1
      )
    )
    database.reset()

    await store.applyDiff(
      {
        sessionId: 'session-1',
        threads: { upsert: [threadRow('thread-active', { name: 'Renamed' })], delete: [] },
        messages: { upsert: [messageRow('thread-active', 'm2', { seq: 1 })], delete: ['m1'] },
      },
      commit(2),
      1
    )

    expect(database.batchCount).toBe(1)
  })

  it('rejects a conditional diff after another commit advances the revision', async () => {
    const { store } = createStore()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [],
        },
        1
      )
    )
    await store.applyDiff(
      {
        sessionId: 'session-1',
        threads: { upsert: [threadRow('thread-active', { name: 'Current' })], delete: [] },
        messages: { upsert: [], delete: [] },
      },
      commit(2),
      1
    )

    await expect(
      store.applyDiff(
        {
          sessionId: 'session-1',
          threads: { upsert: [threadRow('thread-active', { name: 'Stale' })], delete: [] },
          messages: { upsert: [], delete: [] },
        },
        commit(2),
        1
      )
    ).rejects.toMatchObject({
      name: 'SessionRowConflictError',
      expectedRevision: 1,
      actualRevision: 2,
    })
    await expect(store.readSnapshot('session-1')).resolves.toMatchObject({
      rows: { threads: [expect.objectContaining({ name: 'Current' })] },
      revision: 2,
    })
  })

  it('rejects an invalid diff before reaching the database', async () => {
    const { database, store } = createStore()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [messageRow('thread-active', 'm1')],
        },
        1
      )
    )
    database.reset()

    await expect(
      store.applyDiff(
        {
          sessionId: 'session-1',
          threads: { upsert: [], delete: [] },
          messages: { upsert: [messageRow('thread-active', '')], delete: ['m1'] },
        },
        commit(2),
        1
      )
    ).rejects.toMatchObject({ name: 'SessionRowStoreError', operation: 'apply-diff' })

    expect(database.batchCount).toBe(0)
    expect(database.executed).toHaveLength(0)
  })

  it('reads messages back ordered by thread and sequence', async () => {
    const { store } = createStore()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-a'), threadRow('thread-b', { seq: 0 })],
          messages: [
            messageRow('thread-b', 'b2', { seq: 1 }),
            messageRow('thread-a', 'a2', { seq: 1 }),
            messageRow('thread-b', 'b1'),
            messageRow('thread-a', 'a1'),
          ],
        },
        1
      )
    )

    const rows = (await store.readSnapshot('session-1'))?.rows

    expect(rows?.messages.map((row) => row.messageId)).toEqual(['a1', 'a2', 'b1', 'b2'])
  })

  it('round-trips an optional prompt context snapshot without turning absence into null', async () => {
    const { store } = createStore()
    const promptSnapshot = {
      version: 1,
      soul: 'soul document',
      memories: [],
      workspaceInstructions: 'instructions',
      workspaceDirectories: ['/tmp/session-1'],
      capturedAt: 1_500,
    }
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [
            threadRow('thread-plain'),
            threadRow('thread-snapshot', { seq: 0, sessionPromptContextSnapshot: promptSnapshot }),
          ],
          messages: [],
        },
        1
      )
    )

    const rows = (await store.readSnapshot('session-1'))?.rows
    const plain = rows?.threads.find((thread) => thread.threadId === 'thread-plain')
    const withSnapshot = rows?.threads.find((thread) => thread.threadId === 'thread-snapshot')

    expect(plain && 'sessionPromptContextSnapshot' in plain).toBe(false)
    expect(withSnapshot?.sessionPromptContextSnapshot).toEqual(promptSnapshot)
  })

  it('round-trips a multi-megabyte unicode message through payload chunks', async () => {
    const { store } = createStore()
    const text = `${'中文😀\\'.repeat(256 * 1024)}tail`
    const row = messageRow('thread-active', 'huge', {
      message: { id: 'huge', role: 'user', contentParts: [{ type: 'text', text }] },
    })

    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [row],
        },
        1
      )
    )

    await expect(store.readSnapshot('session-1')).resolves.toMatchObject({ rows: { messages: [row] } })
  })

  it('keeps every SQLite read response bounded while hydrating large thread JSON', async () => {
    const underlying = openNodeSessionRowDatabase()
    openDatabases.push(underlying)
    const responseLimit = 512 * 1024
    const database: SessionRowSqlDatabase = {
      execute: (sql) => underlying.execute(sql),
      executeBatch: (statements, options) => underlying.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const rows = await underlying.query<T>(sql, params)
        if (new TextEncoder().encode(JSON.stringify(rows)).byteLength > responseLimit) {
          throw new Error('SQLite bridge response exceeded its limit')
        }
        return rows
      },
    }
    const store = new SqlSessionRowStore(database)
    const largeText = '\\'.repeat(600 * 1024)
    const record = {
      id: 'session-1',
      type: 'chat',
      name: largeText,
      activeThreadId: 'thread-active',
      storageFormat: 'rows',
    } satisfies SessionRecordV2
    const thread = threadRow('thread-active', {
      name: largeText,
      sessionPromptContextSnapshot: {
        version: 1,
        soul: largeText,
        memories: [],
        workspaceInstructions: largeText,
        workspaceDirectories: [],
        capturedAt: 1_000,
      },
    })
    await store.writeRows(snapshot({ sessionId: 'session-1', threads: [thread], messages: [] }, 1, record), null)

    await expect(store.readSnapshot('session-1')).resolves.toEqual({
      rows: { sessionId: 'session-1', threads: [thread], messages: [] },
      record,
      revision: 1,
    })
  })

  it('plans bounded metadata pages without one bridge query per handful of messages', async () => {
    const underlying = openNodeSessionRowDatabase()
    openDatabases.push(underlying)
    const responseLimit = 512 * 1024
    let metadataPageQueries = 0
    const database: SessionRowSqlDatabase = {
      execute: (sql) => underlying.execute(sql),
      executeBatch: (statements, options) => underlying.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        const rows = await underlying.query<T>(sql, params)
        if (sql.includes('FROM session_messages') && sql.includes('LIMIT ? OFFSET ?')) {
          metadataPageQueries++
        }
        expect(new TextEncoder().encode(JSON.stringify(rows)).byteLength).toBeLessThanOrEqual(responseLimit)
        return rows
      },
    }
    const store = new SqlSessionRowStore(database)
    const messages = Array.from({ length: 10_000 }, (_, index) =>
      messageRow('thread-active', `message-${index.toString().padStart(5, '0')}`, { seq: index })
    )
    await store.writeRows(snapshot({ sessionId: 'session-1', threads: [threadRow('thread-active')], messages }, 1))

    const rows = (await store.readSnapshot('session-1'))?.rows

    expect(rows?.messages).toHaveLength(messages.length)
    expect(metadataPageQueries).toBeLessThan(100)
  }, 30_000)

  it('reports a read failure as a store error when a payload chunk is corrupt', async () => {
    const { database, store } = createStore()
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [messageRow('thread-active', 'm1')],
        },
        1
      )
    )
    await database.executeBatch([
      {
        sql: 'UPDATE session_message_payload_chunks SET value = ? WHERE payload_id = (SELECT payload_id FROM session_messages WHERE message_id = ?)',
        params: ['{broken', 'm1'],
      },
    ])

    await expect(store.readSnapshot('session-1')).rejects.toMatchObject({
      name: 'SessionRowStoreError',
      operation: 'read-rows',
      sessionId: 'session-1',
    })
  })

  it('retries when a concurrent publish replaces payload chunks during a read', async () => {
    const underlying = openNodeSessionRowDatabase()
    openDatabases.push(underlying)
    let advanceRevision: (() => Promise<void>) | null = null
    const database: SessionRowSqlDatabase = {
      execute: (sql) => underlying.execute(sql),
      executeBatch: (statements: SessionRowSqlStatement[], options) => underlying.executeBatch(statements, options),
      query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
        if (advanceRevision && sql.includes('FROM session_message_payload_chunks')) {
          const advance = advanceRevision
          advanceRevision = null
          await advance()
        }
        return await underlying.query<T>(sql, params)
      },
    }
    const store = new SqlSessionRowStore(database)
    const currentMessage = messageRow('thread-active', 'm1', {
      updatedAt: 2_000,
      message: { id: 'm1', role: 'user', contentParts: [{ type: 'text', text: 'current payload' }] },
    })
    await store.writeRows(
      snapshot(
        {
          sessionId: 'session-1',
          threads: [threadRow('thread-active')],
          messages: [messageRow('thread-active', 'm1')],
        },
        1
      )
    )
    advanceRevision = () =>
      store.applyDiff(
        {
          sessionId: 'session-1',
          threads: { upsert: [threadRow('thread-active')], delete: [] },
          messages: { upsert: [currentMessage], delete: [] },
        },
        commit(2),
        1
      )

    await expect(store.readSnapshot('session-1')).resolves.toMatchObject({
      rows: { messages: [currentMessage] },
      revision: 2,
    })
  })
})
