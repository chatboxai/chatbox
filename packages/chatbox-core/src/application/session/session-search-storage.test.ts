import { afterEach, describe, expect, it, vi } from 'vitest'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from '../../persistence/node-sqlite.test-support'
import { type SessionRowSqlBindValue, SqlSessionRowStore } from '../../persistence/session-row-sql'
import { SessionRowConflictError } from '../../ports/session-row-store'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import type { Message, Session } from '../../types/session'
import { RowBackedSessionRepository } from './RowBackedSessionRepository'
import { SessionSearchService } from './SessionSearchService'
import { SessionRowWriteQueue } from './SessionRowWriteQueue'
import { encodeSessionTree } from '../../session/session-tree/encode'
import { convertLegacyTreeToRowFormat } from './compatibility/row-format'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

function message(id: string, text: string): Message {
  return { id, role: 'assistant', contentParts: [{ type: 'text', text }] }
}

function fixture(status: 'settled' | 'generating' | 'paused'): Session {
  const session: Session = {
    id: 'search-storage',
    name: 'Chat',
    type: 'chat',
    settings: { agentMode: { value: 'off', locked: false, lockReason: null } },
    messages: Array.from({ length: 120 }, (_, index) =>
      message(`m${index}`, index === 30 ? 'selected needle' : 'ordinary message')
    ),
    threads: Array.from({ length: 25 }, (_, index) => ({
      id: `history-${index}`,
      name: `Old ${index}`,
      createdAt: index,
      messages: [message(`h${index}`, index === 0 ? 'archived needle' : 'ordinary history')],
    })),
    messageForksHash: {
      m118: {
        position: 0,
        createdAt: 1,
        lists: [
          { id: 'selected', messages: [] },
          { id: 'other', messages: [message('hidden-fork', 'unselected needle')] },
        ],
      },
    },
  }
  if (status === 'generating') session.messages[119].generating = true
  if (status === 'paused')
    session.messages[119].contentParts = [
      {
        type: 'tool-call',
        toolCallId: 'pause',
        toolName: 'command',
        state: 'paused',
        pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
      },
    ]
  return session
}

async function harness(status: 'settled' | 'generating' | 'paused' = 'settled') {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const rows = new SqlSessionRowStore(database)
  const records = new InMemorySessionRecordStore()
  const repository = new RowBackedSessionRepository({
    records,
    rows,
    backup: rows,
    writes: new SessionRowWriteQueue((_id, run) => run()),
    now: () => 1,
  })
  const session = fixture(status)
  await rows.initialize()
  const encoded = encodeSessionTree(session, { activeThreadId: session.id, now: 1 })
  if (!encoded.ok) throw new Error(encoded.reason)
  const tree = convertLegacyTreeToRowFormat(encoded.tree, encoded.normalized.messageForksHash)
  await rows.writeRows(
    {
      record: tree.session,
      revision: 1,
      rows: { sessionId: session.id, threads: tree.threads, messages: tree.messages },
    },
    null
  )
  await records.setRecord(tree.session)
  const search = new SessionSearchService(
    {
      listSessionsMetaPage: async () => ({ items: [], nextCursor: null, total: 0 }),
      readSessionSearchCandidates: (request) => repository.readSessionSearchCandidates(request),
      readSessionSearchWindow: (request) => repository.readSessionSearchWindow(request),
    },
    async () => {}
  )
  return { database, rows, records, repository, session, search }
}

describe('search storage on real SQLite', () => {
  it.each(['settled', 'generating', 'paused'] as const)(
    'searches selected forks and archived threads in bounded pages while %s',
    async (status) => {
      const { database, rows, repository, session, search } = await harness(status)
      const messageReads = vi.spyOn(rows, 'readTranscriptWindow')
      const queries: Array<{ sql: string; count: number }> = []
      const query = database.query.bind(database)
      vi.spyOn(database, 'query').mockImplementation(async <T>(sql: string, params: SessionRowSqlBindValue[] = []) => {
        const result = await query<T>(sql, params)
        queries.push({ sql, count: result.length })
        return result
      })
      const result = await search.search('needle', { sessionId: session.id })
      expect(result.failedSessionIds).toEqual([])
      expect(result.hits.map((hit) => hit.messageId)).toEqual(['m30', 'h0'])
      expect(messageReads.mock.calls.length).toBeGreaterThan(2)
      expect(messageReads.mock.calls.every(([request]) => request.limit <= 50 && request.expectedRevision === 1)).toBe(
        true
      )
      expect(queries.filter(({ sql }) => sql.startsWith('WITH page AS')).every(({ count }) => count <= 21)).toBe(true)
      expect(
        queries.filter(({ sql }) => sql.startsWith('WITH RECURSIVE path AS')).every(({ count }) => count <= 51)
      ).toBe(true)
    }
  )

  it('continues SQLite selected-path search between real stream checkpoints', async () => {
    const { repository, rows, session } = await harness('generating')
    let checkpoints = 0
    const search = new SessionSearchService(
      {
        listSessionsMetaPage: async () => ({ items: [], nextCursor: null, total: 0 }),
        readSessionSearchCandidates: (request) => repository.readSessionSearchCandidates(request),
        readSessionSearchWindow: (request) => repository.readSessionSearchWindow(request),
      },
      async () => {
        await repository.executeSessionCommand(session.id, {
          type: 'update',
          messageId: 'm119',
          updater: {
            contentParts: [{ type: 'text', text: `checkpoint ${++checkpoints}` }],
          },
        })
      }
    )
    const reads = vi.spyOn(rows, 'readTranscriptWindow')
    const result = await search.search('needle', { sessionId: session.id })
    expect(result.failedSessionIds).toEqual([])
    expect(result.hits.map((hit) => hit.messageId)).toEqual(['m30', 'h0'])
    expect(checkpoints).toBeGreaterThan(2)
    expect(reads.mock.calls.filter(([request]) => request.origin === 'tail')).toHaveLength(1)
    expect(reads.mock.calls.every(([request]) => request.limit <= 50 && request.maxBytes === 2 * 1024 * 1024)).toBe(
      true
    )
  })

  it('rejects a transcript continuation after a header commit', async () => {
    const { repository, session } = await harness()
    const page = await repository.readSessionTranscriptWindow({ sessionId: session.id, origin: 'tail', limit: 50 })
    if (!page?.older) throw new Error('Expected continuation')
    await repository.executeSessionCommand(session.id, { type: 'header', updater: { name: 'Updated chat' } })
    await expect(
      repository.readSessionTranscriptWindow({
        sessionId: session.id,
        limit: 50,
        cursor: page.older,
        expectedRevision: page.revision,
      })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
  })

  it('stops before another SQLite body page when canceled between batches', async () => {
    const { repository, rows, session } = await harness()
    const controller = new AbortController()
    const canceled = new Error('Canceled by a new query')
    const search = new SessionSearchService(
      {
        listSessionsMetaPage: async () => ({ items: [], nextCursor: null, total: 0 }),
        readSessionSearchCandidates: (request) => repository.readSessionSearchCandidates(request),
        readSessionSearchWindow: (request) => repository.readSessionSearchWindow(request),
      },
      async () => {
        controller.abort(canceled)
      }
    )
    const windows = vi.spyOn(rows, 'readTranscriptWindow')
    await expect(search.search('needle', { sessionId: session.id, signal: controller.signal })).rejects.toBe(canceled)
    expect(windows).toHaveBeenCalledTimes(1)
  })
})
